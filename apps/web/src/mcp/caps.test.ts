import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEV_SPEND_CAPS, PROD_SPEND_CAPS } from "../api/access/policy";
import { formatCapUsdc, spendCapsLabel } from "./caps";

describe("MCP spend cap display", () => {
  it("formats six-decimal caps to two decimals", () => {
    assert.equal(formatCapUsdc("50.000000"), "50.00");
    assert.equal(formatCapUsdc("200.000000"), "200.00");
    assert.equal(formatCapUsdc("25.000000"), "25.00");
    assert.equal(formatCapUsdc("100.000000"), "100.00");
    assert.equal(formatCapUsdc(DEV_SPEND_CAPS.perTxUsdc), "50.00");
    assert.equal(formatCapUsdc(DEV_SPEND_CAPS.dailyUsdc), "200.00");
    assert.equal(formatCapUsdc(PROD_SPEND_CAPS.perTxUsdc), "25.00");
    assert.equal(formatCapUsdc(PROD_SPEND_CAPS.dailyUsdc), "100.00");
  });

  it("does not show the raw six-decimal cap string", () => {
    const label = spendCapsLabel(DEV_SPEND_CAPS.perTxUsdc, DEV_SPEND_CAPS.dailyUsdc);
    assert.equal(label, "50.00 USDC per transaction and 200.00 USDC per UTC day");
    assert.doesNotMatch(label, /000000/);
  });
});
