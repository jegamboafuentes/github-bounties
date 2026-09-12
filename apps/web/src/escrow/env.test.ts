import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CDP_REQUIRED_ENV_KEYS,
  isMainnetAllowed,
  isMainnetNetwork,
  missingCdpEnv,
  probeCdpEnv,
  readCdpNetwork,
} from "./env";
import { EscrowError } from "./errors";
import { createMockRail, resolveRail } from "./rail";
import { attributedAtomic, reconcileBountyNotes } from "./reconcile";
import { moneyIdempotencyKey } from "./idempotency";
import { escrowHealth } from "./service";

describe("CDP env + mainnet refuse", () => {
  it("lists exact missing CDP_* names without reading values", () => {
    assert.deepEqual(missingCdpEnv({}), [...CDP_REQUIRED_ENV_KEYS]);
    assert.deepEqual(
      missingCdpEnv({
        CDP_API_KEY_ID: "id",
        CDP_API_KEY_SECRET: "  ",
      }),
      ["CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"],
    );
  });

  it("defaults to base-sepolia and refuses mainnet without the allow flag", () => {
    assert.equal(readCdpNetwork({}), "base-sepolia");
    assert.equal(isMainnetNetwork("base"), true);
    assert.equal(isMainnetNetwork("eip155:8453"), true);
    assert.equal(isMainnetNetwork("base-sepolia"), false);
    assert.equal(isMainnetAllowed({}), false);
    assert.equal(isMainnetAllowed({ CDP_ALLOW_MAINNET: "1" }), true);

    const probe = probeCdpEnv({ CDP_NETWORK: "base" });
    assert.equal(probe.unsafeNetwork, true);
    assert.equal(probe.mode, "mock");

    assert.throws(
      () => resolveRail({ CDP_NETWORK: "base" }),
      (err: unknown) => err instanceof EscrowError && err.code === "mainnet_refused",
    );
  });

  it("uses mock rail when secrets are missing and documents them", () => {
    const rail = resolveRail({});
    assert.equal(rail.mode, "mock");
    assert.deepEqual(rail.missingEnv, [...CDP_REQUIRED_ENV_KEYS]);
    const mock = createMockRail(probeCdpEnv({}));
    assert.equal(mock.mode, "mock");
  });

  it("keeps attributed recon conservative (no silent loss)", () => {
    const open = attributedAtomic({
      bountyId: "b",
      faceUsdc: "100.000000",
      escrowStatus: "funded",
      fundTxHash: "mock:1",
      payoutTxHash: null,
      feeTxHash: null,
      refundTxHash: null,
    });
    assert.equal(open, 100_000_000n);
    const settled = attributedAtomic({
      bountyId: "b",
      faceUsdc: "100.000000",
      escrowStatus: "settled",
      fundTxHash: "mock:1",
      payoutTxHash: "mock:h",
      feeTxHash: "mock:f",
      refundTxHash: null,
    });
    assert.equal(settled, 0n);
    const notes = reconcileBountyNotes({
      bountyId: "b",
      faceUsdc: "100.000000",
      escrowStatus: "funded",
      fundTxHash: "mock:1",
      payoutTxHash: null,
      feeTxHash: null,
      refundTxHash: null,
    });
    assert.ok(notes.some((n) => n.includes("rail=mock")));
    assert.ok(notes.some((n) => n.includes("Hosted checkout")));
    const health = escrowHealth({});
    assert.equal(health.hosted_checkout.enabled, false);
    assert.equal(health.x402_exact.scheme, "exact");
    assert.equal(health.x402_exact.hostedCheckout, "disabled");
  });

  it("derives stable idempotency keys per bounty+kind", () => {
    const a = moneyIdempotencyKey("11111111-1111-4111-8111-111111111111", "FEE_OUT");
    const b = moneyIdempotencyKey("11111111-1111-4111-8111-111111111111", "FEE_OUT");
    const c = moneyIdempotencyKey("11111111-1111-4111-8111-111111111111", "HUNTER_PAYOUT");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("resolves @coinbase/cdp-sdk CdpClient for the live rail", async () => {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    assert.equal(typeof CdpClient, "function");
  });
});
