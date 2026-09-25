import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refundApiSummary } from "./refund-summary";

const LEG_1 = "0x089200000000000000000000000000000000A7F4";
const LEG_2 = "0x86eb000000000000000000000000000000003098";
const TX_1 = `0x${"21".repeat(32)}`;
const TX_2 = `0x${"cf".repeat(32)}`;

describe("refund API summary", () => {
  it("keeps a single payer's destination and refund tx together", () => {
    assert.deepEqual(
      refundApiSummary({
        legs: [{ destination: LEG_1, txHash: TX_1 }],
        destination: LEG_1,
        refundTxHash: TX_1,
      }),
      { destination: LEG_1, refundTxHash: TX_1 },
    );
  });

  it("drops top-level destination and refundTxHash when legs disagree", () => {
    assert.deepEqual(
      refundApiSummary({
        legs: [
          { destination: LEG_1, txHash: TX_1 },
          { destination: LEG_2, txHash: TX_2 },
        ],
        destination: LEG_1,
        refundTxHash: TX_2,
      }),
      { destination: null, refundTxHash: null },
    );
  });

  it("keeps an already-terminal replay that has no legs array", () => {
    assert.deepEqual(
      refundApiSummary({
        legs: [],
        destination: LEG_1,
        refundTxHash: TX_1,
      }),
      { destination: LEG_1, refundTxHash: TX_1 },
    );
  });
});
