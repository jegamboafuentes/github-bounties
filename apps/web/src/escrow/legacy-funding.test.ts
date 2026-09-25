import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, getAddress, pad, type Hex } from "viem";
import { TRANSFER_TOPIC, type TxLog } from "../../scripts/security/match-usdc-transfer";
import type { Database } from "../db/client";
import {
  applyGuardDecision,
  assessFundingLeg,
  bountyIsAtRisk,
  logLegacyFundVerified,
  parseReconcileCliArgs,
  reconcileFundingScan,
  reconcileLegacyFunding,
  reconcileSummaryLine,
  type FundingLegRecord,
} from "./legacy-funding";
import { coverageDecision } from "./payout-legs";
import { verifiedInflowAtomic, withVerifiedTopUpHash } from "./payout-guard";

const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const ESCROW = getAddress(`0x4a26${"0".repeat(32)}11b8`);
const PAYER = getAddress(`0x86eb${"0".repeat(32)}3098`);
const CROSS = getAddress(`0xacc0${"0".repeat(35)}1`);
const HASH = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;

function transferLog(from: string, value: bigint): TxLog {
  return {
    address: USDC,
    logIndex: 1,
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    topics: [TRANSFER_TOPIC, pad(from as Hex, { size: 32 }), pad(ESCROW as Hex, { size: 32 })],
  };
}

function leg(overrides: Partial<FundingLegRecord> = {}): FundingLegRecord {
  return {
    bountyId: "7bf910cc-0000-4000-8000-000000000001",
    source: "contribution",
    contributionId: "contrib",
    hash: HASH,
    amountUsdc: "1.000000",
    payer: PAYER,
    escrowAddress: ESCROW,
    x402PaymentId: null,
    escrowFundTxHash: OTHER,
    ...overrides,
  };
}

describe("legacy funding assessment", () => {
  it("refuses an unmarked cross-account hash until a matching payer is on the receipt", () => {
    const assessed = assessFundingLeg({
      leg: leg({ bountyId: "00000000-0000-4000-8000-0000000000ac", payer: PAYER, x402PaymentId: null }),
      railMode: "cdp",
      usedByOtherBounty: false,
      usdcContract: USDC,
      receipt: { ok: true, status: "success", logs: [transferLog(CROSS, 1_000_000n)] },
    });
    assert.equal(assessed.countsNow, false);
    assert.equal(assessed.recordable, false);
    assert.equal(assessed.reason, "payer_mismatch");
    assert.equal(assessed.chainFrom?.toLowerCase(), CROSS.toLowerCase());
    assert.equal(bountyIsAtRisk([assessed]), true);
  });

  it("keeps a marked cross-account x402 top-up counted so it still covers a settle", () => {
    const hash = `0x${"ac".repeat(32)}`;
    const paymentId = withVerifiedTopUpHash("x402:facilitator-payment", hash);
    const marked = leg({
      bountyId: "7bf910cc-0000-4000-8000-000000000001",
      hash,
      amountUsdc: "10.000000",
      payer: PAYER,
      x402PaymentId: paymentId,
    });
    const assessed = assessFundingLeg({
      leg: marked,
      railMode: "cdp",
      usedByOtherBounty: false,
      usdcContract: USDC,
      receipt: { ok: true, status: "success", logs: [transferLog(CROSS, 10_000_000n)] },
    });
    assert.equal(assessed.countsNow, true);
    assert.equal(assessed.reason, "counted");
    assert.equal(assessed.recordable, false);
    assert.equal(assessed.chainFrom, null);
    assert.equal(bountyIsAtRisk([assessed]), false);

    const verified = verifiedInflowAtomic({
      railMode: "cdp",
      escrow: {
        amountUsdc: "10.000000",
        fundTxHash: OTHER,
        x402PaymentId: paymentId,
      },
      contributions: [{ amountUsdc: "10.000000", fundTxHash: hash }],
    });
    assert.equal(verified, 10_000_000n);
    const decision = coverageDecision({
      bountyId: marked.bountyId,
      verifiedAtomic: verified,
      paidAtomic: 0n,
      railMode: "cdp",
      legs: [
        {
          destination: "0xwinner",
          amount: "8.330000",
          amountAtomic: 8_330_000n,
          kind: "WINNER_PAYOUT",
          txHash: null,
        },
        {
          destination: "0xfee",
          amount: "0.200000",
          amountAtomic: 200_000n,
          kind: "FEE_OUT",
          txHash: null,
        },
        {
          destination: "0xpool",
          amount: "1.470000",
          amountAtomic: 1_470_000n,
          kind: "POOL_PAYOUT",
          txHash: null,
        },
      ],
    });
    assert.equal(decision.ok, true);
  });

  it("records a legacy hash when the Transfer is from the recorded payer", () => {
    const assessed = assessFundingLeg({
      leg: leg({
        bountyId: "b99a9163-4ef8-4f73-b051-e404b569bc17",
        hash: `0x${"fd".repeat(32)}`,
        payer: PAYER,
      }),
      railMode: "cdp",
      usedByOtherBounty: false,
      usdcContract: USDC,
      receipt: { ok: true, status: "success", logs: [transferLog(PAYER, 1_000_000n)] },
    });
    assert.equal(assessed.countsNow, false);
    assert.equal(assessed.recordable, true);
    assert.equal(assessed.reason, "chain_verified");
    assert.equal(assessed.chainFrom, PAYER);
  });

  it("never records placeholder hashes or a hash reused by another bounty", () => {
    const placeholder = assessFundingLeg({
      leg: leg({ hash: "lock:backfill" }),
      railMode: "cdp",
      usedByOtherBounty: false,
      usdcContract: USDC,
    });
    assert.equal(placeholder.reason, "placeholder");
    assert.equal(placeholder.recordable, false);

    const pasted = assessFundingLeg({
      leg: leg({ hash: "pasted-not-a-tx" }),
      railMode: "cdp",
      usedByOtherBounty: false,
      usdcContract: USDC,
    });
    assert.equal(pasted.reason, "placeholder");
    assert.equal(pasted.recordable, false);

    const reused = assessFundingLeg({
      leg: leg(),
      railMode: "cdp",
      usedByOtherBounty: true,
      usdcContract: USDC,
      receipt: { ok: true, status: "success", logs: [transferLog(PAYER, 1_000_000n)] },
    });
    assert.equal(reused.reason, "hash_reused");
    assert.equal(reused.recordable, false);
  });

  it("allows a PROD dry-run and refuses --apply unless both gates are set", () => {
    assert.deepEqual(
      applyGuardDecision({ apply: false, mainnet: true, allowProdFlag: false, allowProdEnv: false }),
      { ok: true },
    );
    const refused = applyGuardDecision({
      apply: true,
      mainnet: true,
      allowProdFlag: true,
      allowProdEnv: false,
    });
    assert.equal(refused.ok, false);
    const alsoRefused = applyGuardDecision({
      apply: true,
      mainnet: true,
      allowProdFlag: false,
      allowProdEnv: true,
    });
    assert.equal(alsoRefused.ok, false);
    assert.deepEqual(
      applyGuardDecision({ apply: true, mainnet: true, allowProdFlag: true, allowProdEnv: true }),
      { ok: true },
    );
    assert.deepEqual(
      applyGuardDecision({ apply: true, mainnet: false, allowProdFlag: false, allowProdEnv: false }),
      { ok: true },
    );
  });

  it("scans open or unfinished bounties by default and everything with --include-settled", () => {
    const open = ["funded", "claim_locked", "settling", "settled_partial", "refunding"] as const;
    for (const status of open) {
      assert.equal(
        reconcileFundingScan({ bountyStatus: status, escrowStatus: "settled", includeSettled: false }),
        true,
        status,
      );
    }
    for (const status of ["funded", "settling", "settled_partial", "refunding"] as const) {
      assert.equal(
        reconcileFundingScan({ bountyStatus: "settled", escrowStatus: status, includeSettled: false }),
        true,
        status,
      );
    }
    for (const status of ["settled", "refunded", "cancelled", "expired", "void", "pending_fund"] as const) {
      assert.equal(
        reconcileFundingScan({ bountyStatus: status, escrowStatus: "settled", includeSettled: false }),
        false,
        status,
      );
    }
    assert.equal(
      reconcileFundingScan({ bountyStatus: "settled", escrowStatus: "settled", includeSettled: true }),
      true,
    );
    assert.deepEqual(parseReconcileCliArgs(["--apply", "--include-settled"]), {
      apply: true,
      allowProdFlag: false,
      includeSettled: true,
    });
    assert.throws(() => parseReconcileCliArgs(["--settled"]), /Unknown argument/);
    const line = reconcileSummaryLine({
      scanned: 4,
      flagged: 1,
      filter: "open",
      mode: "dry-run",
      mainnet: false,
      atRiskLegs: 1,
      recordable: 1,
      recorded: 0,
    });
    assert.match(line, /scanned=4/);
    assert.match(line, /flagged=1/);
    assert.match(line, /filter=open/);
  });

  it("logs bounty, hash, amount, and outcome when a verified hash is cached", async () => {
    const hash = `0x${"fd".repeat(32)}`;
    const bountyId = "b99a9163-4ef8-4f73-b051-e404b569bc17";
    const updates: { x402PaymentId?: string }[] = [];
    const rows = [
      [{ id: "escrow-1", x402PaymentId: null, escrowAddress: ESCROW, fundTxHash: OTHER, amountUsdc: "1.000000", funderAddress: PAYER }],
      [{ id: "contrib-1", amountUsdc: "1.000000", fundTxHash: hash, funderAddress: PAYER }],
      [],
      [],
    ];
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                const batch = rows.shift() ?? [];
                return Object.assign(Promise.resolve(batch), {
                  limit: async (count: number) => batch.slice(0, count),
                });
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: { x402PaymentId?: string }) {
            return {
              where: async () => {
                updates.push(values);
              },
            };
          },
        };
      },
    } as unknown as Database;
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const recorded = await reconcileLegacyFunding(
        db,
        bountyId,
        async () => ({ ok: true, status: "success", logs: [transferLog(PAYER, 1_000_000n)] }),
        {},
      );
      assert.deepEqual(recorded, [hash]);
    } finally {
      console.log = original;
    }
    assert.match(updates[0]?.x402PaymentId ?? "", new RegExp(hash, "i"));
    const parsed = JSON.parse(lines[0] ?? "{}") as {
      event?: string;
      bountyId?: string;
      hash?: string;
      amountUsdc?: string;
      outcome?: string;
    };
    assert.equal(parsed.event, "legacy_fund_verified");
    assert.equal(parsed.bountyId, bountyId);
    assert.equal(parsed.hash, hash);
    assert.equal(parsed.amountUsdc, "1.000000");
    assert.equal(parsed.outcome, "cached");
    assert.equal(JSON.stringify(parsed).includes("logs"), false);

    const direct: string[] = [];
    console.log = (line?: unknown) => {
      direct.push(String(line));
    };
    try {
      logLegacyFundVerified({ bountyId, hash, amountUsdc: "1.000000", outcome: "cached" });
    } finally {
      console.log = original;
    }
    assert.equal(JSON.parse(direct[0] ?? "{}").outcome, "cached");
  });
});
