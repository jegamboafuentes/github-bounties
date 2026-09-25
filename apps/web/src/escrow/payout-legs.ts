import { EscrowError, type EscrowErrorCode, isEscrowError } from "./errors";
import { logInsufficientBountyFunds } from "./payout-guard";

/** One outbound leg as the API, MCP tools, and error details report it. */
export type PayoutLegReport = {
  destination: string | null;
  /** 6-decimal USDC. */
  amount: string;
  kind: string;
  status: "paid" | "failed" | "pending";
  txHash: string | null;
  reason: string | null;
};

export type CoverageLeg = {
  destination: string | null;
  amount: string;
  amountAtomic: bigint;
  kind: string;
  /** Set when this leg already has a confirmed payout. Resume skips it. */
  txHash: string | null;
  contributionId?: string | null;
};

const COVERAGE_MESSAGE =
  "Refusing payout: verified inflows for this bounty do not cover every remaining leg. Nothing was transferred.";

/**
 * Up-front sum check. Unpaid legs must fit in verified inflow minus
 * amounts already paid. A failing leg blocks every transfer.
 */
export function coverageDecision(input: {
  bountyId: string;
  verifiedAtomic: bigint;
  paidAtomic: bigint;
  railMode: string;
  legs: readonly CoverageLeg[];
}): { ok: true; unpaid: CoverageLeg[] } | { ok: false; error: EscrowError } {
  const unpaid = input.legs.filter((leg) => !leg.txHash?.trim() && leg.amountAtomic > BigInt(0));
  const required = unpaid.reduce((sum, leg) => sum + leg.amountAtomic, BigInt(0));
  if (unpaid.length === 0 || input.verifiedAtomic - input.paidAtomic >= required) {
    return { ok: true, unpaid };
  }
  const legs: PayoutLegReport[] = input.legs.map((leg) => ({
    destination: leg.destination,
    amount: leg.amount,
    kind: leg.kind,
    status: leg.txHash?.trim() ? "paid" : "pending",
    txHash: leg.txHash?.trim() || null,
    reason: leg.txHash?.trim() ? null : "verified inflows do not cover this leg",
  }));
  logInsufficientBountyFunds({
    bountyId: input.bountyId,
    verifiedAtomic: input.verifiedAtomic.toString(),
    paidAtomic: input.paidAtomic.toString(),
    requiredAtomic: required.toString(),
    railMode: input.railMode,
    legs,
  });
  return {
    ok: false,
    error: new EscrowError("insufficient_bounty_funds", COVERAGE_MESSAGE, {
      details: {
        verifiedAtomic: input.verifiedAtomic.toString(),
        paidAtomic: input.paidAtomic.toString(),
        requiredAtomic: required.toString(),
        legs,
      },
    }),
  };
}

function failureCode(err: unknown): EscrowErrorCode {
  if (isEscrowError(err)) return err.code;
  return "rail_failed";
}

function failureMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Payout transfer failed.";
}

/**
 * Pay remaining legs only after `coverageDecision` accepts the full unpaid
 * set. Already-paid legs (recorded tx hash) are skipped. A mid-loop chain
 * error throws with every leg marked paid, failed, or still pending.
 */
export async function executeCoveredLegs(input: {
  bountyId: string;
  verifiedAtomic: bigint;
  paidAtomic: bigint;
  railMode: string;
  legs: CoverageLeg[];
  transfer: (leg: CoverageLeg) => Promise<{ txHash: string }>;
}): Promise<PayoutLegReport[]> {
  const decision = coverageDecision(input);
  if (!decision.ok) throw decision.error;

  const reports: PayoutLegReport[] = input.legs.map((leg) => ({
    destination: leg.destination,
    amount: leg.amount,
    kind: leg.kind,
    status: leg.txHash?.trim() ? "paid" : "pending",
    txHash: leg.txHash?.trim() || null,
    reason: null,
  }));

  const required = decision.unpaid.reduce((sum, leg) => sum + leg.amountAtomic, BigInt(0));
  for (let index = 0; index < input.legs.length; index += 1) {
    const leg = input.legs[index];
    if (!leg || leg.txHash?.trim()) continue;
    try {
      const sent = await input.transfer(leg);
      reports[index] = {
        destination: leg.destination,
        amount: leg.amount,
        kind: leg.kind,
        status: "paid",
        txHash: sent.txHash,
        reason: null,
      };
    } catch (err) {
      const previous = isEscrowError(err) ? (err.details ?? {}) : {};
      reports[index] = {
        destination: leg.destination,
        amount: leg.amount,
        kind: leg.kind,
        status: "failed",
        txHash: null,
        reason: failureMessage(err),
      };
      throw new EscrowError(failureCode(err), failureMessage(err), {
        details: {
          ...previous,
          verifiedAtomic: input.verifiedAtomic.toString(),
          paidAtomic: input.paidAtomic.toString(),
          requiredAtomic: required.toString(),
          legs: reports,
        },
      });
    }
  }
  return reports;
}
