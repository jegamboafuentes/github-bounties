import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCONNECT_GITHUB_NOTICE, unlinkGithubForUser } from "./unlink";

describe("unlinkGithubForUser", () => {
  it("requires a user id and does not delete without one", async () => {
    let deleted = false;
    const db = {
      delete() {
        deleted = true;
        return {
          where() {
            return { returning: async () => [] };
          },
        };
      },
    };

    await assert.rejects(() => unlinkGithubForUser("", db as never), /userId is required/);
    assert.equal(deleted, false);
  });

  it("deletes only github_links for the given userId and returns the login", async () => {
    const calls: Array<{ table: unknown; userId: unknown }> = [];
    const db = {
      delete(table: unknown) {
        return {
          where(condition: unknown) {
            calls.push({ table, userId: condition });
            return {
              returning: async () => [
                {
                  userId: "user-1",
                  githubLogin: "jegamboafuentes",
                  githubId: BigInt(1),
                },
              ],
            };
          },
        };
      },
    };

    const result = await unlinkGithubForUser("user-1", db as never);
    assert.equal(result.deleted, true);
    assert.equal(result.githubLogin, "jegamboafuentes");
    assert.equal(calls.length, 1);
  });

  it("is a no-op when the user has no github_links row", async () => {
    const db = {
      delete() {
        return {
          where() {
            return { returning: async () => [] };
          },
        };
      },
    };

    const result = await unlinkGithubForUser("user-1", db as never);
    assert.deepEqual(result, { deleted: false, githubLogin: null });
  });

  it("keeps the claim-payout reconnect notice", () => {
    assert.equal(DISCONNECT_GITHUB_NOTICE, "Connect GitHub to claim merge payouts.");
  });
});
