"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPageUser } from "@/admin/gate";
import { readOnChainUsdcBalance } from "@/admin/balances";
import { softDeleteBounty } from "@/admin/delete";
import { isAdminError } from "@/admin/errors";
import { cdpNamedAccountClient } from "@/admin/fee-account";
import { adminRefundBounty } from "@/admin/refund";
import { bpsToPercent, setPlatformFee, setPlatformPool } from "@/admin/settings";
import { executeFeeWithdraw, previewFeeWithdraw } from "@/admin/withdraw";
import { getRuntimeDb } from "@/db/runtime";

function fail(err: unknown): { ok: false; error: string; message: string } {
  if (isAdminError(err)) return { ok: false, error: err.code, message: err.message };
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "admin_action_failed",
      reason: err instanceof Error ? err.message : "Failed.",
    }),
  );
  return { ok: false, error: "admin_failed", message: "Admin request failed." };
}

export async function setFeeBpsAction(formData: FormData) {
  const admin = await requireAdminPageUser();
  try {
    const settings = await setPlatformFee(getRuntimeDb(), admin.email, {
      feePercent: String(formData.get("feePercent") ?? ""),
    });
    revalidatePath("/admin");
    return {
      ok: true as const,
      feeBps: settings.feeBps,
      feePercent: bpsToPercent(settings.feeBps),
      poolBps: settings.poolBps,
      poolPercent: bpsToPercent(settings.poolBps),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setPoolBpsAction(formData: FormData) {
  const admin = await requireAdminPageUser();
  try {
    const settings = await setPlatformPool(getRuntimeDb(), admin.email, {
      poolPercent: String(formData.get("poolPercent") ?? ""),
    });
    revalidatePath("/admin");
    return {
      ok: true as const,
      feeBps: settings.feeBps,
      feePercent: bpsToPercent(settings.feeBps),
      poolBps: settings.poolBps,
      poolPercent: bpsToPercent(settings.poolBps),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBountyAction(formData: FormData) {
  const admin = await requireAdminPageUser();
  const bountyId = String(formData.get("bountyId") ?? "");
  try {
    const deleted = await softDeleteBounty({ bountyId, actorEmail: admin.email, db: getRuntimeDb() });
    revalidatePath("/admin");
    return { ok: true as const, id: deleted.id };
  } catch (err) {
    return fail(err);
  }
}

export async function refundBountyAction(formData: FormData) {
  const admin = await requireAdminPageUser();
  const bountyId = String(formData.get("bountyId") ?? "");
  try {
    const refunded = await adminRefundBounty({
      bountyId,
      actorEmail: admin.email,
      db: getRuntimeDb(),
      env: process.env,
    });
    revalidatePath("/admin");
    return { ok: true as const, id: refunded.id, status: refunded.status, refundTxHash: refunded.refundTxHash };
  } catch (err) {
    return fail(err);
  }
}

export async function previewWithdrawAction(formData: FormData) {
  const admin = await requireAdminPageUser();
  try {
    const preview = await previewFeeWithdraw({
      db: getRuntimeDb(),
      env: process.env,
      actorEmail: admin.email,
      amountUsdc: String(formData.get("amountUsdc") ?? ""),
      destination: String(formData.get("destination") ?? ""),
      client: await cdpNamedAccountClient(),
      readBalance: (address) => readOnChainUsdcBalance(address),
    });
    return { ok: true as const, preview };
  } catch (err) {
    return fail(err);
  }
}

export async function executeWithdrawAction(formData: FormData) {
  const admin = await requireAdminPageUser();
  try {
    const sent = await executeFeeWithdraw({
      db: getRuntimeDb(),
      env: process.env,
      actorEmail: admin.email,
      confirmToken: String(formData.get("confirmToken") ?? ""),
      confirmation: String(formData.get("confirmation") ?? ""),
      client: await cdpNamedAccountClient(),
      readBalance: (address) => readOnChainUsdcBalance(address),
    });
    revalidatePath("/admin");
    return { ok: true as const, sent };
  } catch (err) {
    return fail(err);
  }
}
