import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { claims, githubLinks, users } from "../db/schema";
import { hunterLabel } from "../bounties/display";

export const PAYOUT_CLAIM_STATUSES = ["eligible", "paid"] as const;

export type PayoutClaimView = {
  id: string;
  bountyId: string;
  hunterUserId: string;
  hunterLabel: string;
  status: "eligible" | "paid" | string;
  prNumber: number | null;
  prUrl: string | null;
  prAuthorLogin: string | null;
  payoutAddress: string | null;
  payoutUsdc: string | null;
  payoutTxHash: string | null;
  paidAt: Date | null;
};

/**
 * One payout-relevant claim per bounty: paid wins over eligible, then newest.
 */
export async function listPayoutClaimsForBounties(
  db: Database,
  bountyIds: string[],
): Promise<Map<string, PayoutClaimView>> {
  const out = new Map<string, PayoutClaimView>();
  if (bountyIds.length === 0) return out;

  const rows = await db
    .select({
      id: claims.id,
      bountyId: claims.bountyId,
      hunterUserId: claims.hunterUserId,
      status: claims.status,
      prNumber: claims.prNumber,
      prUrl: claims.prUrl,
      prAuthorLogin: claims.prAuthorLogin,
      payoutAddress: claims.payoutAddress,
      payoutUsdc: claims.payoutUsdc,
      payoutTxHash: claims.payoutTxHash,
      paidAt: claims.paidAt,
      displayName: users.displayName,
      githubLogin: githubLinks.githubLogin,
    })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.hunterUserId))
    .leftJoin(githubLinks, eq(githubLinks.userId, users.id))
    .where(
      and(inArray(claims.bountyId, bountyIds), inArray(claims.status, [...PAYOUT_CLAIM_STATUSES])),
    )
    .orderBy(desc(claims.updatedAt));

  for (const row of rows) {
    if (out.has(row.bountyId) && out.get(row.bountyId)?.status === "paid") continue;
    if (out.has(row.bountyId) && row.status !== "paid") continue;
    out.set(row.bountyId, {
      id: row.id,
      bountyId: row.bountyId,
      hunterUserId: row.hunterUserId,
      hunterLabel: hunterLabel({
        githubLogin: row.githubLogin ?? row.prAuthorLogin,
        displayName: row.displayName,
      }),
      status: row.status,
      prNumber: row.prNumber,
      prUrl: row.prUrl,
      prAuthorLogin: row.prAuthorLogin,
      payoutAddress: row.payoutAddress,
      payoutUsdc: row.payoutUsdc,
      payoutTxHash: row.payoutTxHash,
      paidAt: row.paidAt,
    });
  }

  return out;
}

export async function getPayoutClaimForBounty(
  db: Database,
  bountyId: string,
): Promise<PayoutClaimView | null> {
  const map = await listPayoutClaimsForBounties(db, [bountyId]);
  return map.get(bountyId) ?? null;
}
