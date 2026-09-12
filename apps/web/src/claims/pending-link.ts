import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { webhookDeliveries, type WebhookClaimResult } from "../db/schema";
import { CLAIM_SKIP } from "../webhooks/outcome";

export type PendingHunterLink = {
  winnerLogin: string;
  prNumber: number | null;
  skip: "hunter_not_linked";
};

export type PendingHunterLinkTarget = {
  id: string;
  githubIssueNumber: number;
  repoFullName: string;
};

export function pendingHunterLinkCaption(winnerLogin: string): string {
  return `Merged PR author ${winnerLogin} must Connect GitHub as that login before payout. The claim-lock holder is not the winner.`;
}

export function pendingHunterLinkGuidance(winnerLogin: string): string {
  return `This bounty has no eligible claim because GitHub user ${winnerLogin} (the merged pull request author) is not linked. Sign in and Connect GitHub as ${winnerLogin}, then Ops can redeliver the merge webhook (or Connect GitHub backfill writes the claim). Do not pay the claim-lock holder.`;
}

export function pendingHunterLinkFromDelivery(
  delivery: {
    claimResults?: WebhookClaimResult[] | null;
    winnerLogin?: string | null;
    pullRequestNumber?: number | null;
    repositoryFullName?: string | null;
  },
  bounty: PendingHunterLinkTarget,
): PendingHunterLink | null {
  for (const row of delivery.claimResults ?? []) {
    if (row.skip !== CLAIM_SKIP.hunterNotLinked) continue;
    const login = (row.winnerLogin ?? delivery.winnerLogin ?? "").trim();
    if (!login) continue;
    const bountyMatch = row.bountyId === bounty.id;
    const repo = (delivery.repositoryFullName ?? "").trim().toLowerCase();
    const issueMatch =
      row.issueNumber === bounty.githubIssueNumber &&
      repo === bounty.repoFullName.toLowerCase();
    if (!bountyMatch && !issueMatch) continue;
    return {
      winnerLogin: login,
      prNumber: row.prNumber ?? delivery.pullRequestNumber ?? null,
      skip: CLAIM_SKIP.hunterNotLinked,
    };
  }
  return null;
}

export async function listPendingHunterLinksForBounties(
  db: Database,
  targets: PendingHunterLinkTarget[],
): Promise<Map<string, PendingHunterLink>> {
  const out = new Map<string, PendingHunterLink>();
  if (targets.length === 0) return out;

  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.eligible, true));

  for (const bounty of targets) {
    for (const delivery of deliveries) {
      const pending = pendingHunterLinkFromDelivery(delivery, bounty);
      if (pending) {
        out.set(bounty.id, pending);
        break;
      }
    }
  }
  return out;
}

export async function getPendingHunterLinkForBounty(
  db: Database,
  bounty: PendingHunterLinkTarget,
): Promise<PendingHunterLink | null> {
  const map = await listPendingHunterLinksForBounties(db, [bounty]);
  return map.get(bounty.id) ?? null;
}
