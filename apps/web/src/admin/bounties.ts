import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, bountyStatusValues, repos } from "../db/schema";
import { AdminError } from "./errors";

export type AdminBountyRow = {
  id: string;
  title: string;
  repoFullName: string;
  githubIssueNumber: number;
  status: string;
  amountUsdc: string;
  refundable: boolean;
  createdAt: string;
};

const REFUNDABLE = new Set(["funded", "claim_locked"]);

export function adminBountyRefundable(status: string): boolean {
  return REFUNDABLE.has(status);
}

export function parseAdminBountyStatus(value: string | undefined | null): (typeof bountyStatusValues)[number] | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  if ((bountyStatusValues as readonly string[]).includes(trimmed)) {
    return trimmed as (typeof bountyStatusValues)[number];
  }
  throw new AdminError(400, "invalid_status", "Unknown bounty status.");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function clampLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || value == null) return 20;
  return Math.min(100, Math.max(1, value));
}

function clampOffset(value: number | undefined): number {
  if (!Number.isInteger(value) || value == null || value < 0) return 0;
  return value;
}

export async function listAdminBounties(
  db: Database,
  input: { search?: string; status?: string | null; limit?: number; offset?: number },
): Promise<{ bounties: AdminBountyRow[]; total: number; limit: number; offset: number }> {
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);
  const status = parseAdminBountyStatus(input.status);
  const search = input.search?.trim().slice(0, 200) ?? "";
  const pattern = search ? `%${escapeLike(search)}%` : "";
  const where = and(
    isNull(bounties.deletedAt),
    status ? eq(bounties.status, status) : undefined,
    search
      ? sql`(
          ${bounties.title} ilike ${pattern}
          or ${repos.fullName} ilike ${pattern}
          or cast(${bounties.githubIssueNumber} as text) ilike ${pattern}
          or cast(${bounties.id} as text) ilike ${pattern}
        )`
      : undefined,
  );
  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: bounties.id,
        title: bounties.title,
        status: bounties.status,
        amountUsdc: bounties.amountUsdc,
        githubIssueNumber: bounties.githubIssueNumber,
        createdAt: bounties.createdAt,
        repoFullName: repos.fullName,
      })
      .from(bounties)
      .innerJoin(repos, eq(repos.id, bounties.repoId))
      .where(where)
      .orderBy(desc(bounties.createdAt), desc(bounties.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bounties)
      .innerJoin(repos, eq(repos.id, bounties.repoId))
      .where(where),
  ]);
  const total = Number(countRows[0]?.n ?? 0);
  return {
    bounties: rows.map((row) => ({
      id: row.id,
      title: row.title,
      repoFullName: row.repoFullName,
      githubIssueNumber: row.githubIssueNumber,
      status: row.status,
      amountUsdc: row.amountUsdc,
      refundable: adminBountyRefundable(row.status),
      createdAt: row.createdAt.toISOString(),
    })),
    total: Number.isFinite(total) ? total : 0,
    limit,
    offset,
  };
}
