import { notFound } from "next/navigation";
import { readBalanceSnapshot, balanceSnapshotJson } from "@/admin/balances";
import { cdpNamedAccountClient } from "@/admin/fee-account";
import { requireAdminPageUser } from "@/admin/gate";
import { readPlatformSettings } from "@/admin/settings";
import { withdrawEnabled } from "@/admin/withdraw-guards";
import { AdminDashboard, type AdminDashboardData } from "@/components/admin-dashboard";
import { getRuntimeDb } from "@/db/runtime";
import { readCdpNetwork } from "@/escrow/env";

export const dynamic = "force-dynamic";

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_UI_FIXTURE === "1";
}

function fixtureData(step: string | undefined): AdminDashboardData {
  const destination = "0x1111111111111111111111111111111111111111";
  return {
    actorEmail: "admin@example.com",
    network: "base",
    feeBps: 200,
    poolBps: 1500,
    escrowAddress: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
    feeAddress: "0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8",
    escrowOnChainUsdc: "5.000000",
    escrowLiabilitiesUsdc: "3.000000",
    feeOnChainUsdc: "1.286600",
    feesEarnedUsdc: "0.186600",
    feesWithdrawnUsdc: "0.000000",
    withdrawEnabled: true,
    fixture: {
      step: step === "withdraw" || step === "delete" ? step : undefined,
      destination,
      amountUsdc: "0.100000",
      deleteError:
        step === "delete"
          ? "bounty_has_funds_refund_first: This bounty has funds, a contribution, a lock, or an in-flight allocation. Refund it before deleting."
          : undefined,
    },
  };
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; step?: string }>;
}) {
  const query = await searchParams;
  if (fixtureEnabled()) {
    if (query.as === "denied") notFound();
    return <AdminDashboard data={fixtureData(query.step)} />;
  }

  const admin = await requireAdminPageUser();
  const db = getRuntimeDb();
  const settings = await readPlatformSettings(db);
  let balances: ReturnType<typeof balanceSnapshotJson> | null = null;
  try {
    const snapshot = await readBalanceSnapshot(db, await cdpNamedAccountClient(), process.env);
    balances = balanceSnapshotJson(snapshot);
  } catch {
    balances = null;
  }

  const data: AdminDashboardData = {
    actorEmail: admin.email,
    network: readCdpNetwork(),
    feeBps: settings.feeBps,
    poolBps: settings.poolBps,
    escrowAddress: balances?.escrow.address ?? "unavailable",
    feeAddress: balances?.fee.address ?? "unavailable",
    escrowOnChainUsdc: balances?.escrow.onChainUsdc ?? "unavailable",
    escrowLiabilitiesUsdc: balances?.escrow.liabilitiesUsdc ?? "unavailable",
    feeOnChainUsdc: balances?.fee.onChainUsdc ?? "unavailable",
    feesEarnedUsdc: balances?.fee.earnedUsdc ?? "unavailable",
    feesWithdrawnUsdc: balances?.fee.withdrawnUsdc ?? "unavailable",
    withdrawEnabled: withdrawEnabled(),
  };
  return <AdminDashboard data={data} />;
}
