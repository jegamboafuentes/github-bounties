import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeGithubFileContent } from "./api";

describe("GitHub file content", () => {
  it("decodes README base64 payloads used for the intelligence blurb", () => {
    const encoded = Buffer.from("# Hello\nA widget lib.", "utf8").toString("base64");
    assert.equal(decodeGithubFileContent(encoded, "base64"), "# Hello\nA widget lib.");
    assert.equal(decodeGithubFileContent("plain", "utf-8"), "plain");
    assert.equal(decodeGithubFileContent(undefined, "base64"), "");
  });
});
