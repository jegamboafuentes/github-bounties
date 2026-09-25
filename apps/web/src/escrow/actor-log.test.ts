import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { logMoneyAction, takeRequestId } from "./actor-log";

describe("money action log", () => {
  it("emits one allowlisted JSON line and drops secrets", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      logMoneyAction({
        action: "refund",
        actorUserId: "user-1",
        bountyId: "bounty-1",
        contributionId: "contrib-1",
        claimId: null,
        destination: "0x1111111111111111111111111111111111111111",
        amountUsdc: "10.000000",
        txHash: "0xabc",
        result: "ok",
        requestId: "req-1",
      });
    } finally {
      console.log = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(parsed.event, "money_action");
    assert.equal(parsed.action, "refund");
    assert.equal(parsed.actorUserId, "user-1");
    assert.equal(parsed.bountyId, "bounty-1");
    assert.equal(parsed.contributionId, "contrib-1");
    assert.equal(parsed.destination, "0x1111111111111111111111111111111111111111");
    assert.equal(parsed.amountUsdc, "10.000000");
    assert.equal(parsed.txHash, "0xabc");
    assert.equal(parsed.result, "ok");
    assert.equal(parsed.requestId, "req-1");
    assert.equal("email" in parsed, false);
    assert.equal("token" in parsed, false);
    assert.equal("signature" in parsed, false);
    assert.equal("payer" in parsed, false);
  });

  it("logs inbound lock and top_up as payer and keeps destination for outbound", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      logMoneyAction({
        action: "lock",
        actorUserId: "user-1",
        bountyId: "bounty-1",
        payer: "0x2222222222222222222222222222222222222222",
        destination: "0x1111111111111111111111111111111111111111",
        amountUsdc: "10.000000",
        txHash: "0xabc",
        result: "ok",
        requestId: "req-lock",
      });
      logMoneyAction({
        action: "top_up",
        actorUserId: "user-1",
        bountyId: "bounty-1",
        payer: "0x2222222222222222222222222222222222222222",
        amountUsdc: "4.000000",
        txHash: "0xdef",
        result: "ok",
        requestId: "req-top",
      });
    } finally {
      console.log = original;
    }
    const lock = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const topUp = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    assert.equal(lock.payer, "0x2222222222222222222222222222222222222222");
    assert.equal("destination" in lock, false);
    assert.equal(topUp.payer, "0x2222222222222222222222222222222222222222");
    assert.equal("destination" in topUp, false);
  });

  it("mints a request id when the header is empty or unsafe", () => {
    assert.equal(takeRequestId("req_42"), "req_42");
    assert.notEqual(takeRequestId("has spaces"), "has spaces");
    assert.notEqual(takeRequestId("Bearer secret-token"), "Bearer secret-token");
    assert.match(takeRequestId(null), /^[0-9a-f-]{36}$/);
  });
});
