import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMAIL_TEMPLATE_VALUES } from "../db/schema";
import { renderEmail, welcomeIdempotencyKey } from "./templates";

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

  it("keeps pool Claim copy manual and welcome idempotency stable", () => {
    const pool = renderEmail("pool_claimable", {
      displayName: "Ada",
      origin: "https://dev.githubbounties.xyz",
    });
    assert.match(pool.text, /Manual pool Claim is unchanged/);
    assert.match(pool.html, /never a private address scraped from GitHub/);
    const userId = "00000000-0000-4000-8000-000000000001";
    assert.equal(welcomeIdempotencyKey(userId), `welcome:${userId}`);
  });
});
