import { notFound } from "next/navigation";
import { readBalanceReport, type BalanceReport } from "@/admin/balances";
import { listAdminBounties, parseAdminBountyStatus, type AdminBountyRow } from "@/admin/bounties";
import { requireAdminPageUser } from "@/admin/gate";
import { bpsToPercent, readPlatformSettings } from "@/admin/settings";
import { withdrawEnabled } from "@/admin/withdraw-guards";
import { bountyStatusLabel } from "@/bounties/display";
import { AdminDashboard, type AdminDashboardData } from "@/components/admin-dashboard";
import { getRuntimeDb } from "@/db/runtime";
import { bountyStatusValues } from "@/db/schema";
import { readCdpNetwork } from "@/escrow/env";
import { isAdminError } from "@/admin/errors";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_UI_FIXTURE === "1";
}

function fixtureBounties(): AdminBountyRow[] {
  return [
    {
      id: "20bb5c8a-fd55-4f67-bb03-635611ef588c",
      title: "Cancelled draft",
      repoFullName: "acme/widgets",
      githubIssueNumber: 12,
      status: "cancelled",
      amountUsdc: "10.000000",
      refundable: false,
      createdAt: "2026-09-01T12:00:00.000Z",
    },
    {
      id: "145f3f18-a165-451b-991b-7f7d519baac9",
      title: "Paid fix",
      repoFullName: "acme/widgets",
      githubIssueNumber: 40,
      status: "settled",
      amountUsdc: "1.000000",
      refundable: false,
      createdAt: "2026-08-20T12:00:00.000Z",
    },
    {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      title: "Open hunt",
      repoFullName: "acme/api",
      githubIssueNumber: 7,
      status: "funded",
      amountUsdc: "25.000000",
      refundable: true,
      createdAt: "2026-09-28T12:00:00.000Z",
    },
  ];
}

function fixtureData(step: string | undefined, search: string, status: string): AdminDashboardData {
  const destination = "0x1111111111111111111111111111111111111111";
  const rows = fixtureBounties().filter((row) => {
    if (status && row.status !== status) return false;
    if (!search) return true;
    const haystack = `${row.title} ${row.repoFullName} ${row.githubIssueNumber} ${row.id}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  return {
    actorEmail: "admin@example.com",
    network: "base-sepolia",
    feePercent: "2.00",
    poolPercent: "15.00",
    escrowAddress: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
    feeAddress: "0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8",
    escrowOnChain: { text: "23.600000", error: false },
    liabilities: { text: "3.000000", error: false },
    feeOnChain: { text: "0.664200", error: false },
    feesEarned: { text: "0.664200", error: false },
    feesWithdrawn: { text: "0.000000", error: false },
    withdrawEnabled: true,
    bounties: {
      rows,
      total: rows.length,
      page: 1,
      pageCount: 1,
      search,
      status,
    },
    statusOptions: bountyStatusValues.map((value) => ({ value, label: bountyStatusLabel(value) })),
    fixture: {
      step: step === "withdraw" || step === "delete" || step === "refund" ? step : undefined,
      destination,
      amountUsdc: "0.100000",
      deleteError:
        step === "delete"
          ? "bounty_has_funds_refund_first: This bounty still has funds in escrow. Refund it before deleting. Blocked by: escrow still holds an unrefunded, unpaid remainder."
          : undefined,
    },
  };
}

function tileText(usdc: string | null, error: string | null, fallback: string): { text: string; error: boolean } {
  if (error) return { text: error, error: true };
  return { text: usdc ?? fallback, error: false };
}

function addressText(report: BalanceReport, which: "escrowAddress" | "feeAddress"): string {
  const tile = report[which];
  return tile.address ?? tile.error ?? "Address unavailable";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; step?: string; q?: string; status?: string; page?: string }>;
}) {
  const query = await searchParams;
  const search = query.q?.trim() ?? "";
  let status = "";
  try {
    status = parseAdminBountyStatus(query.status) ?? "";
  } catch (err) {
    if (!isAdminError(err)) throw err;
  }
  if (fixtureEnabled()) {
    if (query.as === "denied") notFound();
    return <AdminDashboard data={fixtureData(query.step, search, status)} />;
  }

  const admin = await requireAdminPageUser();
  const db = getRuntimeDb();
  const settings = await readPlatformSettings(db);
  const report = await readBalanceReport(db, process.env);
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const listed = await listAdminBounties(db, {
    search,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(listed.total / PAGE_SIZE));

  const data: AdminDashboardData = {
    actorEmail: admin.email,
    network: readCdpNetwork(),
    feePercent: bpsToPercent(settings.feeBps),
    poolPercent: bpsToPercent(settings.poolBps),
    escrowAddress: addressText(report, "escrowAddress"),
    feeAddress: addressText(report, "feeAddress"),
    escrowOnChain: tileText(report.escrowOnChain.usdc, report.escrowOnChain.error, "—"),
    liabilities: tileText(report.liabilities.usdc, report.liabilities.error, "—"),
    feeOnChain: tileText(report.feeOnChain.usdc, report.feeOnChain.error, "—"),
    feesEarned: tileText(report.feesEarned.usdc, report.feesEarned.error, "—"),
    feesWithdrawn: tileText(report.feesWithdrawn.usdc, report.feesWithdrawn.error, "—"),
    withdrawEnabled: withdrawEnabled(),
    bounties: {
      rows: listed.bounties,
      total: listed.total,
      page,
      pageCount,
      search,
      status,
    },
    statusOptions: bountyStatusValues.map((value) => ({ value, label: bountyStatusLabel(value) })),
  };
  return <AdminDashboard data={data} />;
}
