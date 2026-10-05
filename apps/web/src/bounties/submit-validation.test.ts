import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleSubmitPr, type ApiPrincipal } from "../api/access/handlers";
import type { AccessDeps } from "../api/access/deps";
import { PublicApiError } from "../api/public/errors";
import { submissionUniqueConflictMessage } from "./submissions";

const principal: ApiPrincipal = {
  keyId: "key",
  userId: "user",
  name: "key",
  env: "test",
  prefix: "gb_test",
  scopes: new Set(["write"]),
  perTxCapUsdc: "10",
  dailyCapUsdc: "10",
};

async function messageFor(body: unknown): Promise<string> {
  try {
    await handleSubmitPr(principal, "00000000-0000-4000-8000-000000000001", body, {} as AccessDeps);
  } catch (err) {
    assert.ok(err instanceof PublicApiError);
    return err.message;
  }
  throw new Error("expected validation_failed");
}

describe("submit pr validation", () => {
  it("names the zod problem instead of always saying prUrl is required", async () => {
    assert.equal(await messageFor({}), "prUrl is required.");
    assert.equal(await messageFor({ prUrl: "" }), "prUrl is required.");
    assert.equal(await messageFor({ prUrl: "https://huggingface.co/a/b/discussions/1", extra: 1 }), "Unrecognized field: extra.");
    assert.equal(await messageFor({ prUrl: 12 }), "prUrl: Expected string, received number");
    assert.match(await messageFor({ prUrl: "x".repeat(501) }), /prUrl: String must contain at most 500 character/);
  });

  it("does not call the caller's own active submission a taken pull request", () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "bounty_submissions_active_user_uidx"'), {
      code: "23505",
      constraint_name: "bounty_submissions_active_user_uidx",
    });
    assert.match(submissionUniqueConflictMessage(err), /Withdraw it before submitting another/);
    const taken = Object.assign(new Error('duplicate key value violates unique constraint "bounty_submissions_bounty_pr_uidx"'), {
      code: "23505",
    });
    assert.match(submissionUniqueConflictMessage(taken), /already submitted for this bounty/);
  });
});
