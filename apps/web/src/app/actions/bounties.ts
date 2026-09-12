"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPublicUser } from "@/auth/protect";
import {
  acquireClaimLock,
  createBountyFromIssueUrl,
  isBountyError,
  releaseClaimLock,
  fundBounty,
} from "@/bounties";
import { claimPayout, isClaimError } from "@/claims";
import { getRuntimeDb } from "@/db/runtime";
import { isEscrowError, refundEscrow } from "@/escrow";
import { INVALID_BASE_ADDRESS_MESSAGE, normalizeBaseAddress } from "@/lib/address";
import { setUserWalletAddress } from "@/auth/users";

export type BountyActionState = {
  ok: boolean;
  error?: string;
  message?: string;
};

function fail(err: unknown): BountyActionState {
  if (isBountyError(err) || isClaimError(err)) {
    return { ok: false, error: err.code, message: err.message };
  }
  return {
    ok: false,
    error: "unknown",
    message: err instanceof Error ? err.message : "Something went wrong.",
  };
}

function refreshBounty(id: string) {
  revalidatePath("/board");
  revalidatePath(`/bounties/${id}`);
}

export async function createBountyAction(
  _prev: BountyActionState | undefined,
  formData: FormData,
): Promise<BountyActionState> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/bounties/new")}`);
  }

  try {
    const created = await createBountyFromIssueUrl(
      {
        posterUserId: user.id,
        issueUrl: String(formData.get("issueUrl") ?? ""),
        amountUsdc: String(formData.get("amountUsdc") ?? ""),
      },
      { db: getRuntimeDb() },
    );
    revalidatePath("/board");
    redirect(`/bounties/${created.id}`);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return fail(err);
  }
}

export async function fundBountyAction(formData: FormData): Promise<void> {
  const bountyId = String(formData.get("bountyId") ?? "");
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bountyId}`)}`);
  }
  try {
    const funded = await fundBounty(bountyId, user.id, getRuntimeDb());
    refreshBounty(bountyId);
    if (funded.rail === "mock" && funded.missingEnv?.length) {
      redirect(
        `/bounties/${bountyId}?notice=${encodeURIComponent(
          `Mock escrow lock (not on-chain). Missing CDP env: ${funded.missingEnv.join(", ")}. See docs/escrow.md.`,
        )}`,
      );
    }
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirectBountyError(bountyId, err);
  }
}

export async function cancelBountyAction(formData: FormData): Promise<void> {
  const bountyId = String(formData.get("bountyId") ?? "");
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bountyId}`)}`);
  }
  try {
    await refundEscrow(bountyId, { actorUserId: user.id, reason: "cancel" }, { db: getRuntimeDb() });
    refreshBounty(bountyId);
  } catch (err) {
    redirectBountyError(bountyId, err);
  }
}

export async function acquireClaimLockAction(formData: FormData): Promise<void> {
  const bountyId = String(formData.get("bountyId") ?? "");
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bountyId}`)}`);
  }
  try {
    await acquireClaimLock(bountyId, user.id, { db: getRuntimeDb() });
    refreshBounty(bountyId);
  } catch (err) {
    redirectBountyError(bountyId, err);
  }
}

export async function claimPayoutAction(formData: FormData): Promise<void> {
  const bountyId = String(formData.get("bountyId") ?? "");
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bountyId}`)}`);
  }
  try {
    const result = await claimPayout(
      bountyId,
      user.id,
      {
        payoutAddress: String(formData.get("payoutAddress") ?? ""),
        claimId: String(formData.get("claimId") ?? "") || undefined,
        persistWallet: true,
      },
      { db: getRuntimeDb() },
    );
    refreshBounty(bountyId);
    if (result.rail === "mock" && result.missingEnv.length) {
      redirect(
        `/bounties/${bountyId}?notice=${encodeURIComponent(
          `Payout recorded on the mock rail (not on-chain). Missing CDP env: ${result.missingEnv.join(", ")}. See docs/escrow.md.`,
        )}`,
      );
    }
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirectBountyError(bountyId, err);
  }
}

export async function saveWalletAddressAction(
  _prev: BountyActionState | undefined,
  formData: FormData,
): Promise<BountyActionState> {
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  }
  try {
    const address = normalizeBaseAddress(String(formData.get("walletAddress") ?? ""));
    await setUserWalletAddress(user.id, address, getRuntimeDb());
    revalidatePath("/settings");
    return { ok: true, message: "Base payout address saved." };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof Error && err.message === INVALID_BASE_ADDRESS_MESSAGE) {
      return { ok: false, error: "invalid_payout_address", message: err.message };
    }
    return fail(err);
  }
}

export async function releaseClaimLockAction(formData: FormData): Promise<void> {
  const bountyId = String(formData.get("bountyId") ?? "");
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bountyId}`)}`);
  }
  try {
    await releaseClaimLock(bountyId, user.id, getRuntimeDb());
    refreshBounty(bountyId);
  } catch (err) {
    redirectBountyError(bountyId, err);
  }
}

function redirectBountyError(bountyId: string, err: unknown): never {
  const code = isBountyError(err)
    ? err.code
    : isClaimError(err)
      ? err.code
      : isEscrowError(err)
        ? err.code
        : "unknown";
  const message = isBountyError(err)
    ? err.message
    : isClaimError(err)
      ? err.message
      : isEscrowError(err)
        ? err.message
        : err instanceof Error
          ? err.message
          : "Something went wrong.";
  refreshBounty(bountyId);
  redirect(`/bounties/${bountyId}?error=${encodeURIComponent(`${code}: ${message}`)}`);
}

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    String((err as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}
