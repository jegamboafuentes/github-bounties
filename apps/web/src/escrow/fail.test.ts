import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EscrowError } from "./errors";
import { formatEscrowFailLabel, toPersistedLockFailure } from "./fail";
import { escrowErrorJson, httpStatusForEscrowCode } from "./http";
import { inferEscrowRail } from "./read";

describe("Lock fail code + reason", () => {
  it("keeps inbound_unconfirmed code and message (does not remap)", () => {
    const err = new EscrowError(
      "inbound_unconfirmed",
      "Send face USDC to gb-escrow (0xabc) on base-sepolia, then retry fund with the on-chain tx hash.",
      { details: { escrowAddress: "0xabc", network: "base-sepolia" } },
    );
    const persisted = toPersistedLockFailure(err);
    assert.equal(persisted.code, "inbound_unconfirmed");
    assert.match(persisted.reason, /Send face USDC/);
    assert.equal(persisted.error.code, "inbound_unconfirmed");

    const json = escrowErrorJson(err);
    assert.equal(json.ok, false);
    assert.equal(json.error, "inbound_unconfirmed");
    assert.equal(json.fail_code, "inbound_unconfirmed");
    assert.equal(json.fail_reason, err.message);
    assert.equal(json.details?.escrowAddress, "0xabc");
    assert.equal(httpStatusForEscrowCode("inbound_unconfirmed"), 400);
  });

  it("wraps unknown rail throws as rail_failed so the reason is never blank", () => {
    const persisted = toPersistedLockFailure(new Error("CDP getOrCreateAccount 401"));
    assert.equal(persisted.code, "rail_failed");
    assert.equal(persisted.reason, "CDP getOrCreateAccount 401");
    assert.equal(httpStatusForEscrowCode("rail_failed"), 400);
    assert.equal(httpStatusForEscrowCode("cdp_sdk_missing"), 400);
    assert.equal(httpStatusForEscrowCode("unauthorized"), 401);
    assert.equal(httpStatusForEscrowCode("bounty_not_found"), 404);
  });

  it("formats UI label and infers rail from probe when hashes are missing", () => {
    assert.equal(
      formatEscrowFailLabel("inbound_unconfirmed", "Send face USDC"),
      "inbound_unconfirmed · Send face USDC",
    );
    assert.equal(formatEscrowFailLabel(null, null), null);
    assert.equal(inferEscrowRail([null, null], "cdp"), "cdp");
    assert.equal(inferEscrowRail(["mock:0xabc"], "cdp"), "mock");
    assert.equal(inferEscrowRail(["0xdead"], "mock"), "cdp");
  });
});
