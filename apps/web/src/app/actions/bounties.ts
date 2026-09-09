"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPublicUser } from "@/auth/protect";
import {
  acquireClaimLock,
  createBountyFromIssueUrl,
  isBountyError,
  releaseClaimLock,
  stubFundBounty,
} from "@/bounties";
import { getRuntimeDb } from "@/db/runtime";

export type BountyActionState = {
  ok: boolean;
  error?: string;
  message?: string;
};

function fail(err: unknown): BountyActionState {
  if (isBountyError(err)) {
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

export async function stubFundBountyAction(formData: FormData): Promise<void> {
  const bountyId = String(formData.get("bountyId") ?? "");
  const user = await getCurrentPublicUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/bounties/${bountyId}`)}`);
  }
  try {
    await stubFundBounty(bountyId, user.id, getRuntimeDb());
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
  const message = isBountyError(err)
    ? err.message
    : err instanceof Error
      ? err.message
      : "Something went wrong.";
  redirect(`/bounties/${bountyId}?error=${encodeURIComponent(message)}`);
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
