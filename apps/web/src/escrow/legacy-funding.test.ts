import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, getAddress, pad, type Hex } from "viem";
import { TRANSFER_TOPIC, type TxLog } from "../../scripts/security/match-usdc-transfer";
import { applyGuardDecision, assessFundingLeg, bountyIsAtRisk, type FundingLegRecord } from "./legacy-funding";

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
  it("flags a cross-account top-up like DEV 7bf910cc from 0xacc0 and does not record it", () => {
    const assessed = assessFundingLeg({
      leg: leg({ bountyId: "7bf910cc-0000-4000-8000-000000000001", payer: PAYER }),
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
});
