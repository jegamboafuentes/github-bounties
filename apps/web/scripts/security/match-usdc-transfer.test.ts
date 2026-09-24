import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, getAddress, pad, type Hex } from "viem";
import { withVerifiedTopUpHash } from "../../src/escrow/payout-guard";
import {
  TRANSFER_TOPIC,
  matchEscrowUsdcTransfer,
  type TxLog,
} from "./match-usdc-transfer";
import {
  contributionNeedsTopUpMarker,
  planMarkerUpdate,
  recordedCreditUsdc,
  renderCorrectionScript,
  type CitedEvidence,
} from "./render-corrections";

const USDC = getAddress("0x1111111111111111111111111111111111111111");
const LOOKALIKE = getAddress("0x2222222222222222222222222222222222222222");
const ESCROW = getAddress("0x3333333333333333333333333333333333333333");
const SENDER = getAddress("0x4444444444444444444444444444444444444444");
const OTHER = getAddress("0x5555555555555555555555555555555555555555");
const WRONG_TO = getAddress("0x6666666666666666666666666666666666666666");
const AMOUNT = 10_000_000n;
const TX = `0x${"ab".repeat(32)}` as Hex;
const BOUNTY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ESCROW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CONTRIBUTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function transferLog(input: {
  contract: string;
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
}): TxLog {
  return {
    address: input.contract,
    logIndex: input.logIndex,
    data: encodeAbiParameters([{ type: "uint256" }], [input.value]),
    topics: [
      TRANSFER_TOPIC,
      pad(input.from as Hex, { size: 32 }),
      pad(input.to as Hex, { size: 32 }),
    ],
  };
}

function match(logs: TxLog[], amount = AMOUNT) {
  return matchEscrowUsdcTransfer({
    logs,
    usdcContract: USDC,
    escrowWallet: ESCROW,
    amountAtomic: amount,
    receiptStatus: "success",
  });
}

function evidence(logIndex: number, from = SENDER): CitedEvidence {
  return {
    logIndex,
    contract: USDC,
    from,
    to: ESCROW,
    amountAtomic: AMOUNT,
    txHash: TX,
    blockNumber: 123n,
  };
}

describe("matchEscrowUsdcTransfer", () => {
  it("takes the sender from the single configured-USDC transfer into the escrow wallet", () => {
    const result = match([
      transferLog({
        contract: USDC,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 4,
      }),
      transferLog({
        contract: USDC,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT - 1n,
        logIndex: 5,
      }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.evidence.from, SENDER);
    assert.equal(result.evidence.to, ESCROW);
    assert.equal(result.evidence.logIndex, 4);
    assert.equal(result.evidence.amountAtomic, AMOUNT);
    assert.equal(result.evidence.contract, USDC);
  });

  it("refuses a lookalike token contract", () => {
    const result = match([
      transferLog({
        contract: LOOKALIKE,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 1,
      }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "wrong_token");
    assert.match(result.detail, /not the configured USDC/i);
  });

  it("refuses a transfer to the wrong recipient", () => {
    const result = match([
      transferLog({
        contract: USDC,
        from: SENDER,
        to: WRONG_TO,
        value: AMOUNT,
        logIndex: 2,
      }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "no_matching_log");
  });

  it("refuses an amount mismatch", () => {
    const result = match([
      transferLog({
        contract: USDC,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT + 1n,
        logIndex: 3,
      }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "no_matching_log");
  });

  it("refuses multiple matching USDC transfers", () => {
    const result = match([
      transferLog({
        contract: USDC,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 7,
      }),
      transferLog({
        contract: USDC,
        from: OTHER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 8,
      }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "multiple_matches");
    assert.match(result.detail, /7, 8/);
  });

  it("keeps a configured-USDC match when a lookalike for the same amount is also present", () => {
    const result = match([
      transferLog({
        contract: LOOKALIKE,
        from: OTHER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 1,
      }),
      transferLog({
        contract: USDC,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 2,
      }),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.evidence.from, SENDER);
    assert.equal(result.evidence.contract, USDC);
    assert.equal(result.evidence.logIndex, 2);
  });

  it("refuses a sender equal to the escrow wallet", () => {
    const result = match([
      transferLog({
        contract: USDC,
        from: ESCROW,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 9,
      }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "sender_is_escrow");
  });
});

describe("correction SQL", () => {
  const chain = {
    chainId: 8453,
    chainName: "Base",
    usdcContract: USDC,
    network: "base",
  };

  it("prints a funder update from the log and rolls back", () => {
    const script = renderCorrectionScript({
      chain,
      funderUpdates: [
        {
          escrowId: ESCROW_ID,
          bountyId: BOUNTY,
          fundTxHash: TX,
          funderAddress: SENDER,
          escrowAddress: ESCROW,
          amountSource: "contribution",
          evidence: evidence(4),
        },
      ],
      markerUpdates: [],
      refusals: [],
    });
    assert.match(script, /^-- derive-funder-corrections/);
    assert.match(script, /\nBEGIN;\n/);
    assert.match(script, /\nROLLBACK;\n/);
    assert.doesNotMatch(script, /\nCOMMIT;/);
    assert.match(script, new RegExp(`tx_hash=${TX}`));
    assert.match(script, /block=123/);
    assert.match(script, /log_index=4/);
    assert.match(script, new RegExp(`from=${SENDER}`));
    assert.match(script, new RegExp(`to=${ESCROW}`));
    assert.match(script, /amount_atomic=10000000/);
    assert.match(script, /amount_usdc=10\.000000/);
    assert.match(script, new RegExp(`SET funder_address = '${SENDER}'`));
    assert.match(script, /lower\(btrim\(funder_address\)\) = lower\(btrim\(escrow_address\)\)/);
    assert.doesNotMatch(script, /wallet_address/);
    assert.doesNotMatch(script, /poster_wallet/);
    assert.doesNotMatch(script, /COALESCE/i);
  });

  it("appends x402-topup:<hash> only for a verified contribution and quotes the payment id", () => {
    const previous = "x402:0xlock'; DROP TABLE escrows; --";
    const hash = TX;
    const planned = planMarkerUpdate({
      escrowId: ESCROW_ID,
      bountyId: BOUNTY,
      previousPaymentId: previous,
      contributions: [
        {
          contributionId: CONTRIBUTION,
          fundTxHash: hash,
          evidence: evidence(6),
        },
      ],
    });
    assert.equal(planned.nextPaymentId, withVerifiedTopUpHash(previous, hash));
    assert.match(planned.nextPaymentId, new RegExp(`x402-topup:${hash}`));
    const script = renderCorrectionScript({
      chain,
      funderUpdates: [],
      markerUpdates: [planned],
      refusals: [],
    });
    assert.match(script, /x402-topup:/);
    assert.match(script, /x402:0xlock''; DROP TABLE escrows;/);
    assert.doesNotMatch(script, /x402:0xlock'; DROP TABLE escrows;/);
    assert.match(script, /\nROLLBACK;\n/);
  });

  it("does not emit UPDATE when the only candidate is a lookalike token", () => {
    const matched = match([
      transferLog({
        contract: LOOKALIKE,
        from: SENDER,
        to: ESCROW,
        value: AMOUNT,
        logIndex: 1,
      }),
    ]);
    assert.equal(matched.ok, false);
    if (matched.ok) return;
    const script = renderCorrectionScript({
      chain,
      funderUpdates: [],
      markerUpdates: [],
      refusals: [
        {
          bountyId: BOUNTY,
          escrowId: ESCROW_ID,
          kind: "funder_address",
          txHash: TX,
          code: matched.code,
          detail: matched.detail,
        },
      ],
    });
    assert.match(script, /code=wrong_token/);
    assert.match(script, /No UPDATE for this row/);
    assert.doesNotMatch(script, /^UPDATE /m);
    assert.match(script, /\nROLLBACK;\n/);
  });

  it("uses the contribution amount for the fund tx, not a later escrow face", () => {
    assert.deepEqual(recordedCreditUsdc("2.000000", "5.000000"), {
      usdc: "2.000000",
      source: "contribution",
    });
    assert.deepEqual(recordedCreditUsdc(null, "5.000000"), {
      usdc: "5.000000",
      source: "escrow_face",
    });
  });

  it("treats an existing x402-topup line as already marked and ignores the lock hash", () => {
    assert.equal(
      contributionNeedsTopUpMarker({
        contributionFundTxHash: TX,
        escrowFundTxHash: `0x${"cd".repeat(32)}`,
        x402PaymentId: `x402:0xlock\nx402-topup:${TX}`,
      }),
      false,
    );
    assert.equal(
      contributionNeedsTopUpMarker({
        contributionFundTxHash: TX,
        escrowFundTxHash: TX,
        x402PaymentId: "x402:0xlock",
      }),
      false,
    );
    assert.equal(
      contributionNeedsTopUpMarker({
        contributionFundTxHash: TX,
        escrowFundTxHash: `0x${"cd".repeat(32)}`,
        x402PaymentId: "x402:0xlock",
      }),
      true,
    );
  });
});
