import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGitHubIssueUrl } from "./parse-issue-url";

describe("parseGitHubIssueUrl", () => {
  it("parses https issue URLs and strips fragments", () => {
    const parsed = parseGitHubIssueUrl(
      "https://github.com/octo/hello/issues/42#issuecomment-1",
    );
    assert.deepEqual(parsed, {
      owner: "octo",
      repo: "hello",
      fullName: "octo/hello",
      issueNumber: 42,
      url: "https://github.com/octo/hello/issues/42",
    });
  });

  it("accepts www and protocol-relative hosts", () => {
    const parsed = parseGitHubIssueUrl("www.github.com/Acme-Org/app.js/issues/7");
    assert.equal(parsed?.fullName, "Acme-Org/app.js");
    assert.equal(parsed?.issueNumber, 7);
  });

  it("rejects pull URLs, empty input, and non-issue paths", () => {
    assert.equal(parseGitHubIssueUrl(""), null);
    assert.equal(parseGitHubIssueUrl("https://github.com/octo/hello/pull/15"), null);
    assert.equal(parseGitHubIssueUrl("https://gitlab.com/octo/hello/issues/1"), null);
    assert.equal(parseGitHubIssueUrl("https://github.com/octo/hello/issues/0"), null);
  });
});
