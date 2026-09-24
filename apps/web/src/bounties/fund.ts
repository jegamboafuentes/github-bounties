import type { Database } from "../db/client";
import type { DomainEmailDeps } from "../email/events";
import { EscrowError, lockEscrowFunds, topUpFundedBounty, type CdpRail, type TopUpResult } from "../escrow";
import { BountyError } from "./errors";

export type FundedBounty = {
  id: string;
  status: "funded";
  fundedAt: Date;
  fundTxHash?: string;
  rail?: "cdp" | "mock";
  missingEnv?: string[];
};

/**
 * Fund lock: pending_fund → funded, escrow pending → funded (locked).
 * Uses the CDP rail when secrets exist; otherwise a documented mock path.
 */
export async function fundBounty(
  bountyId: string,
  actorUserId: string,
  db: Database,
  now: Date = new Date(),
  opts?: { rail?: CdpRail; fundTxHash?: string | null; email?: DomainEmailDeps },
): Promise<FundedBounty> {
  try {
    const locked = await lockEscrowFunds(bountyId, actorUserId, {
      db,
      now,
      rail: opts?.rail,
      fundTxHash: opts?.fundTxHash,
      email: opts?.email,
    });
    return {
      id: locked.bountyId,
      status: "funded",
      fundedAt: locked.fundedAt,
      fundTxHash: locked.fundTxHash,
      rail: locked.rail,
      missingEnv: locked.missingEnv,
    };
  } catch (err) {
    throw toFundError(err);
  }
}

/**
 * Crowdfund top-up: add USDC to an already-funded bounty on the same rail.
 * Face grows; fee and pool math stay the existing split of that face.
 */
export async function topUpBounty(
  bountyId: string,
  actorUserId: string,
  input: { amountUsdc: string; fundTxHash?: string | null; funderAddress?: string | null },
  db: Database,
  now: Date = new Date(),
  opts?: { rail?: CdpRail },
): Promise<TopUpResult> {
  try {
    return await topUpFundedBounty(bountyId, actorUserId, input, {
      db,
      now,
      rail: opts?.rail,
    });
  } catch (err) {
    throw toFundError(err);
  }
}

function toFundError(err: unknown): never {
  if (err instanceof BountyError) throw err;
  if (err instanceof EscrowError) throw err;
  throw err;
}
