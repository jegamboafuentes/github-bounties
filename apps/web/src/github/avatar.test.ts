import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { githubAvatarUrl, githubProfileUrl } from "./avatar";

describe("GitHub avatar from login", () => {
  it("builds avatars.githubusercontent.com URLs and skips empty identity", () => {
    assert.equal(
      githubAvatarUrl("octocat"),
      "https://avatars.githubusercontent.com/octocat?s=64",
    );
    assert.equal(
      githubAvatarUrl("  Ada-Maintainer  ", 40),
      "https://avatars.githubusercontent.com/Ada-Maintainer?s=40",
    );
    assert.equal(githubAvatarUrl(null), null);
    assert.equal(githubAvatarUrl("   "), null);
    assert.equal(githubAvatarUrl(""), null);
  });

  it("builds a github.com profile URL", () => {
    assert.equal(githubProfileUrl("octocat"), "https://github.com/octocat");
    assert.equal(githubProfileUrl(null), null);
  });
});
