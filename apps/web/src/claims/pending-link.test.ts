import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pendingHunterLinkCaption,
  pendingHunterLinkFromDelivery,
  pendingHunterLinkGuidance,
} from "./pending-link";

const bounty = {
  id: "145f3f18-0000-4000-8000-000000000031",
  githubIssueNumber: 31,
  repoFullName: "jegamboafuentes/LB-DEMO",
};

describe("pending hunter GitHub link", () => {
  it("matches hunter_not_linked by bounty id and names the PR author", () => {
    const pending = pendingHunterLinkFromDelivery(
      {
        winnerLogin: "enrique-lb",
        pullRequestNumber: 32,
        repositoryFullName: "jegamboafuentes/LB-DEMO",
        claimResults: [
          {
            issueNumber: 31,
            bountyId: bounty.id,
            skip: "hunter_not_linked",
            winnerLogin: "enrique-lb",
            prNumber: 32,
          },
        ],
      },
      bounty,
    );
    assert.deepEqual(pending, {
      winnerLogin: "enrique-lb",
      prNumber: 32,
      skip: "hunter_not_linked",
    });
  });

  it("matches by repo + issue when bountyId is absent", () => {
    const pending = pendingHunterLinkFromDelivery(
      {
        winnerLogin: "enrique-lb",
        repositoryFullName: "Jegamboafuentes/LB-DEMO",
        claimResults: [{ issueNumber: 31, skip: "hunter_not_linked" }],
      },
      bounty,
    );
    assert.equal(pending?.winnerLogin, "enrique-lb");
  });

  it("does not treat a different issue or skip as a pending link", () => {
    assert.equal(
      pendingHunterLinkFromDelivery(
        {
          winnerLogin: "enrique-lb",
          repositoryFullName: bounty.repoFullName,
          claimResults: [{ issueNumber: 99, skip: "hunter_not_linked" }],
        },
        bounty,
      ),
      null,
    );
    assert.equal(
      pendingHunterLinkFromDelivery(
        {
          winnerLogin: "enrique-lb",
          repositoryFullName: bounty.repoFullName,
          claimResults: [{ issueNumber: 31, skip: "no_funded_bounty" }],
        },
        bounty,
      ),
      null,
    );
  });

  it("tells the PR author to Connect GitHub and not the lock holder", () => {
    assert.match(pendingHunterLinkCaption("enrique-lb"), /enrique-lb/);
    assert.match(pendingHunterLinkCaption("enrique-lb"), /Connect GitHub/);
    assert.match(pendingHunterLinkCaption("enrique-lb"), /claim-lock holder is not the winner/i);
    assert.match(pendingHunterLinkGuidance("enrique-lb"), /enrique-lb/);
    assert.match(pendingHunterLinkGuidance("enrique-lb"), /Do not pay the claim-lock holder/);
  });
});
