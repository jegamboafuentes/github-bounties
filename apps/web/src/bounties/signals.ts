import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { bounties, githubLinks, users, workSignals } from "../db/schema";
import { hunterLabel } from "./display";
import { BountyError } from "./errors";

export type WorkSignalView = {
  id: string;
  bountyId: string;
  userId: string;
  githubLogin: string | null;
  hunterLabel: string;
  signaledAt: Date;
};

const SIGNALABLE_STATUSES = new Set([
  "pending_fund",
  "funded",
  "claim_locked",
]);

/**
 * Public reads hide work signals once a bounty is cancelled.
 * Rows stay in `work_signals`; this does not clear or delete them.
 */
export function publicWorkSignals<T>(status: string, signals: readonly T[]): T[] {
  if (status === "cancelled") return [];
  return [...signals];
}

/**
 * Optional non-blocking “Working on this”. Many hunters per bounty.
 * Not exclusive. Does not change pool eligibility `E` or money.
 */
export async function signalWorkingOnThis(
  bountyId: string,
  userId: string,
  db: Database,
  now: Date = new Date(),
): Promise<WorkSignalView> {
  if (!userId) {
    throw new BountyError("unauthorized", "Sign in with Google to signal Working on this.");
  }

  const [bounty] = await db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    throw new BountyError("bounty_not_found", "Bounty not found.");
  }
  if (!SIGNALABLE_STATUSES.has(bounty.status)) {
    throw new BountyError(
      "not_claimable",
      `Bounty is ${bounty.status}; Working on this is for open bounties.`,
    );
  }

  const existing = await activeSignalForUser(db, bountyId, userId);
  if (existing) return existing;

  const [inserted] = await db
    .insert(workSignals)
    .values({
      bountyId,
      userId,
      signaledAt: now,
      clearedAt: null,
    })
    .returning({
      id: workSignals.id,
      bountyId: workSignals.bountyId,
      userId: workSignals.userId,
      signaledAt: workSignals.signaledAt,
    });
  if (!inserted) {
    throw new Error("insert work_signal returned no row");
  }

  const views = await listWorkSignalsForBounties(db, [bountyId]);
  const mine = (views.get(bountyId) ?? []).find((row) => row.id === inserted.id);
  return (
    mine ?? {
      id: inserted.id,
      bountyId: inserted.bountyId,
      userId: inserted.userId,
      githubLogin: null,
      hunterLabel: "someone",
      signaledAt: inserted.signaledAt,
    }
  );
}

/** Clear the caller’s uncleared signal. Idempotent if none is active. */
export async function clearWorkSignal(
  bountyId: string,
  userId: string,
  db: Database,
  now: Date = new Date(),
): Promise<{ cleared: number }> {
  if (!userId) {
    throw new BountyError("unauthorized", "Sign in with Google to clear Working on this.");
  }

  const [bounty] = await db.select({ id: bounties.id }).from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    throw new BountyError("bounty_not_found", "Bounty not found.");
  }

  const updated = await db
    .update(workSignals)
    .set({ clearedAt: now, updatedAt: now })
    .where(
      and(
        eq(workSignals.bountyId, bountyId),
        eq(workSignals.userId, userId),
        isNull(workSignals.clearedAt),
      ),
    )
    .returning({ id: workSignals.id });

  return { cleared: updated.length };
}

export async function listWorkSignalsForBounties(
  db: Database,
  bountyIds: string[],
): Promise<Map<string, WorkSignalView[]>> {
  const out = new Map<string, WorkSignalView[]>();
  if (bountyIds.length === 0) return out;

  const rows = await db
    .select({
      id: workSignals.id,
      bountyId: workSignals.bountyId,
      userId: workSignals.userId,
      signaledAt: workSignals.signaledAt,
      displayName: users.displayName,
      githubLogin: githubLinks.githubLogin,
    })
    .from(workSignals)
    .innerJoin(users, eq(users.id, workSignals.userId))
    .leftJoin(githubLinks, eq(githubLinks.userId, workSignals.userId))
    .where(and(inArray(workSignals.bountyId, bountyIds), isNull(workSignals.clearedAt)))
    .orderBy(desc(workSignals.signaledAt));

  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.bountyId}:${row.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const view: WorkSignalView = {
      id: row.id,
      bountyId: row.bountyId,
      userId: row.userId,
      githubLogin: row.githubLogin,
      hunterLabel: hunterLabel({
        githubLogin: row.githubLogin,
        displayName: row.displayName,
      }),
      signaledAt: row.signaledAt,
    };
    const list = out.get(row.bountyId) ?? [];
    list.push(view);
    out.set(row.bountyId, list);
  }

  for (const list of out.values()) {
    list.sort((a, b) => a.signaledAt.getTime() - b.signaledAt.getTime());
  }
  return out;
}

async function activeSignalForUser(
  db: Database,
  bountyId: string,
  userId: string,
): Promise<WorkSignalView | null> {
  const map = await listWorkSignalsForBounties(db, [bountyId]);
  return (map.get(bountyId) ?? []).find((row) => row.userId === userId) ?? null;
}
