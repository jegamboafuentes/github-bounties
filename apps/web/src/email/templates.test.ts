import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderBountyFundedEmail,
  renderBountyMergedEmail,
  renderBountySettledEmail,
  renderPoolClaimableEmail,
  renderWelcomeEmail,
} from "./templates";

const bounty = {
  baseUrl: "https://dev.githubbounties.xyz",
  displayName: "Ada",
  bountyTitle: "Fix the parser",
  bountyUrl: "https://dev.githubbounties.xyz/bounties/1",
  amountUsdc: "10",
};

describe("branded email templates", () => {
  it("renders a responsive welcome with the logo, plain text, and escaped names", () => {
    const mail = renderWelcomeEmail({
      displayName: "<b>Ada</b>",
      baseUrl: "javascript:alert(1)",
    });
    assert.equal(mail.subject, "Welcome to GitHub Bounties");
    assert.match(mail.html, /max-width:600px/);
    assert.match(mail.html, /width="100%"/);
    assert.match(mail.html, /src="https:\/\/dev\.githubbounties\.xyz\/brand\/logo-1\.png"/);
    assert.match(mail.html, /&lt;b&gt;Ada&lt;\/b&gt;/);
    assert.doesNotMatch(mail.html, /<b>Ada<\/b>/);
    assert.doesNotMatch(mail.html, /javascript:/);
    assert.match(mail.text, /Welcome, <b>Ada<\/b>\./);
    assert.match(mail.text, /Browse open bounties: https:\/\/dev\.githubbounties\.xyz\/board/);
    assert.match(mail.text, /do not use scraped GitHub addresses/);
    assert.doesNotMatch(mail.text, /<html/);
  });

  it("keeps funded, merge, settled, and pool-claimable primitives unsent", () => {
    const funded = renderBountyFundedEmail(bounty);
    const merged = renderBountyMergedEmail({ ...bounty, winnerLogin: "octocat" });
    const settled = renderBountySettledEmail(bounty);
    const pool = renderPoolClaimableEmail({ ...bounty, shareUsdc: "1.5" });
    for (const mail of [funded, merged, settled, pool]) {
      assert.match(mail.html, /logo-1\.png/);
      assert.match(mail.html, /max-width:600px/);
      assert.match(mail.text, /Fix the parser/);
      assert.match(mail.text, /do not use scraped GitHub addresses/);
    }
    assert.match(funded.subject, /Bounty funded/);
    assert.match(merged.text, /octocat/);
    assert.match(settled.text, /does not move|not a payment instruction|On-chain settlement is unchanged/);
    assert.match(pool.text, /does not move USDC/);
    assert.match(pool.text, /1\.5 USDC/);
  });
});
