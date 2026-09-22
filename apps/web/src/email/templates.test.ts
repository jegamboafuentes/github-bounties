import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMAIL_TEMPLATE_VALUES } from "../db/schema";
import {
  bountyFundedIdempotencyKey,
  bountySettledIdempotencyKey,
  poolClaimableIdempotencyKey,
  prMergedIdempotencyKey,
  renderEmail,
  welcomeIdempotencyKey,
} from "./templates";

describe("email templates", () => {
  it("renders branded html and plain text for every primitive", () => {
    for (const template of EMAIL_TEMPLATE_VALUES) {
      const rendered = renderEmail(template, {
        displayName: "Ada <script>",
        origin: "https://dev.githubbounties.xyz",
        payload: {
          bountyTitle: "Fix the parser",
          bountyUrl: "https://dev.githubbounties.xyz/bounties/1",
          amountLabel: "10 USDC",
          repoFullName: "octo/hello",
          issueNumber: 42,
        },
      });
      assert.ok(rendered.subject.length > 0);
      assert.match(rendered.html, /logo-wordmark\.png/);
      assert.match(rendered.html, /GitHub Bounties/);
      assert.match(rendered.html, /max-width:560px/);
      assert.match(rendered.html, /Ada &lt;script&gt;/);
      assert.doesNotMatch(rendered.html, /<script>/);
      assert.match(rendered.text, /GitHub Bounties/);
      assert.match(rendered.text, /Ada <script>/);
      assert.doesNotMatch(rendered.text, /<html/);
      assert.doesNotMatch(rendered.html, /RESEND_API_KEY/);
    }
  });

  it("states who won, who did not, and the locked or paid amount", () => {
    const input = {
      displayName: "Ada",
      origin: "https://dev.githubbounties.xyz",
      payload: {
        bountyTitle: "Fix the parser",
        bountyUrl: "https://dev.githubbounties.xyz/bounties/1",
        amountLabel: "10 USDC",
        repoFullName: "octo/hello",
        issueNumber: 42,
      },
    };
    const funded = renderEmail("bounty_funded", input);
    assert.match(funded.subject, /Your bounty is funded/);
    assert.match(funded.text, /funded and the face amount is locked for 10 USDC/);
    assert.match(funded.text, /octo\/hello #42/);
    assert.match(funded.text, /funder/);
    assert.match(funded.html, /View bounty/);

    const won = renderEmail("pr_merged", input);
    assert.match(won.subject, /You won the bounty/);
    assert.match(won.text, /you won/i);
    assert.match(won.text, /winning eligibility/);
    assert.match(won.text, /main reward/);
    assert.match(won.text, /does not settle or pay/);

    const settled = renderEmail("bounty_settled", input);
    assert.match(settled.subject, /Your winner share was paid: 10 USDC/);
    assert.match(settled.text, /The net amount paid to your wallet is 10 USDC/);
    assert.match(settled.text, /does not submit another payout/);

    const pool = renderEmail("pool_claimable", input);
    assert.match(pool.subject, /You did not win/);
    assert.match(pool.text, /you did not win the main reward/i);
    assert.match(pool.text, /earned participation-pool amount is 10 USDC/);
    assert.match(pool.text, /Manual pool Claim is unchanged/);
    assert.match(pool.text, /Claim your share: https:\/\/dev\.githubbounties\.xyz\/bounties\/1/);
    assert.match(pool.html, /never a private address scraped from GitHub/);

    const userId = "00000000-0000-4000-8000-000000000001";
    const bountyId = "00000000-0000-4000-8000-000000000002";
    const claimId = "00000000-0000-4000-8000-000000000003";
    const participantId = "00000000-0000-4000-8000-000000000004";
    assert.equal(welcomeIdempotencyKey(userId), `welcome:${userId}`);
    assert.equal(bountyFundedIdempotencyKey(bountyId), `bounty_funded:${bountyId}`);
    assert.equal(prMergedIdempotencyKey(claimId), `pr_merged:${claimId}`);
    assert.equal(bountySettledIdempotencyKey(claimId), `bounty_settled:${claimId}`);
    assert.equal(
      poolClaimableIdempotencyKey(bountyId, participantId),
      `pool_claimable:${bountyId}:${participantId}`,
    );
  });
});
