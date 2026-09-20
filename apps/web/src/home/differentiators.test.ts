import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEE_BPS } from "../lib/constants";
import { homepageCtas } from "./ctas";
import { HOMEPAGE_DIFFERENTIATORS, NOT_LIGHTNING_BOUNTIES } from "./differentiators";

describe("homepage differentiators and CTAs", () => {
  it("contrasts GitHub Bounties with Lightning Bounties / LB1", () => {
    assert.match(NOT_LIGHTNING_BOUNTIES, /not Lightning Bounties/i);
    assert.match(NOT_LIGHTNING_BOUNTIES, /LB1/);
    const blob = HOMEPAGE_DIFFERENTIATORS.map((item) => `${item.title} ${item.body}`).join("\n");
    assert.match(blob, /Fair hunter economics/);
    assert.match(blob, /V2 pool/);
    assert.match(blob, /USDC/);
    assert.match(blob, /not Lightning Network/i);
    assert.match(blob, new RegExp(`${FEE_BPS / 100}%`));
    assert.match(blob, /fee_bps = 200/);
  });

  it("keeps sign-in, board, and post CTAs", () => {
    const signedOut = homepageCtas(false);
    assert.deepEqual(
      signedOut.map((cta) => cta.href),
      ["/board", "/bounties/new", "/signin"],
    );
    const signedIn = homepageCtas(true);
    assert.deepEqual(
      signedIn.map((cta) => cta.href),
      ["/board", "/bounties/new", "/settings"],
    );
  });
});
