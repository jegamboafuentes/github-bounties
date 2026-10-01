import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { balanceReportJson, readBalanceTiles } from "./balances";

describe("admin balance tiles", () => {
  it("does not query the allocation_ledger_kind enum with REFUND_OUT", () => {
    const source = readFileSync(new URL("./balances.ts", import.meta.url), "utf8");
    assert.equal(source.includes("REFUND_OUT"), false);
    assert.match(source, /refund_tx_hash/);
  });

  it("keeps a good tile when another tile throws", async () => {
    const report = await readBalanceTiles({
      network: "base-sepolia",
      loadAccounts: async () => {
        throw new Error("cdp down");
      },
      feeAddressFallback: () => "0x0000000000000000000000000000000000000001",
      readOnChain: async (address) => (address.endsWith("1") ? BigInt(664200) : BigInt(0)),
      liabilities: async () => {
        throw new Error('invalid input value for enum allocation_ledger_kind: "REFUND_OUT"');
      },
      feesEarned: async () => BigInt(664200),
      feesWithdrawn: async () => BigInt(0),
    });
    assert.equal(report.escrowOnChain.usdc, null);
    assert.match(report.escrowOnChain.error ?? "", /cdp down/);
    assert.equal(report.liabilities.usdc, null);
    assert.match(report.liabilities.error ?? "", /REFUND_OUT/);
    assert.equal(report.feeOnChain.usdc, "0.664200");
    assert.equal(report.feeOnChain.error, null);
    assert.equal(report.feesEarned.usdc, "0.664200");
    assert.equal(report.feesWithdrawn.error, null);
    const json = balanceReportJson(report);
    assert.equal(json.fee.earnedUsdc, "0.664200");
    assert.equal(json.escrow.liabilitiesUsdc, null);
    assert.ok(json.escrow.liabilitiesError);
  });
});
