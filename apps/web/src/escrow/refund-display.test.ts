import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refundLegTxHashes } from "./refund-display";

const LEG_1 = `0x${"21".repeat(32)}`;
const LEG_2 = `0x${"cf".repeat(32)}`;

describe("refund leg tx hashes", () => {
  it("lists every contribution refund hash, then the escrow hash when it is another leg", () => {
    assert.deepEqual(
      refundLegTxHashes({
        contributionRefundTxHashes: [LEG_1, null, "  "],
        escrowRefundTxHash: LEG_2,
      }),
      [LEG_1, LEG_2],
    );
  });

  it("does not repeat the last leg when the escrow row stores that same hash", () => {
    assert.deepEqual(
      refundLegTxHashes({
        contributionRefundTxHashes: [LEG_1, LEG_2.toUpperCase()],
        escrowRefundTxHash: LEG_2,
      }),
      [LEG_1, LEG_2.toUpperCase()],
    );
  });

  it("shows the single escrow hash when contributions have no refund tx", () => {
    assert.deepEqual(
      refundLegTxHashes({
        contributionRefundTxHashes: [null],
        escrowRefundTxHash: LEG_2,
      }),
      [LEG_2],
    );
  });
});
