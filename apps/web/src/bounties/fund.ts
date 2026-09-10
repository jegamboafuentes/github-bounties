import type { Database } from "../db/client";
import { EscrowError, lockEscrowFunds, type CdpRail } from "../escrow";
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
  opts?: { rail?: CdpRail; fundTxHash?: string | null },
): Promise<FundedBounty> {
  try {
    const locked = await lockEscrowFunds(bountyId, actorUserId, {
      db,
      now,
      rail: opts?.rail,
      fundTxHash: opts?.fundTxHash,
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
    throw toBountyError(err);
  }
}

function toBountyError(err: unknown): never {
  if (err instanceof BountyError) throw err;
  if (err instanceof EscrowError) {
    const mapped =
      err.code === "unauthorized" ||
      err.code === "bounty_not_found" ||
      err.code === "not_poster" ||
      err.code === "not_fundable"
        ? err.code
        : "not_fundable";
    throw new BountyError(mapped, err.message);
  }
  throw err;
}
