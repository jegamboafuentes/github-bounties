import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { githubSignature256, verifyGitHubSignature } from "./verify-signature";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("verifyGitHubSignature", () => {
  it("matches GitHub's official HMAC-SHA256 test vector", () => {
    const vector = JSON.parse(
      readFileSync(join(root, "fixtures/github-official-signature.json"), "utf8"),
    ) as { secret: string; payload: string; signature256: string };

    const raw = Buffer.from(vector.payload, "utf8");
    assert.equal(githubSignature256(raw, vector.secret), vector.signature256);
    assert.equal(verifyGitHubSignature(raw, vector.signature256, vector.secret), true);
  });

  it("rejects a tampered payload", () => {
    const secret = "It's a Secret to Everybody";
    const signature = githubSignature256("Hello, World!", secret);
    assert.equal(
      verifyGitHubSignature(Buffer.from("Hello, World?"), signature, secret),
      false,
    );
  });

  it("rejects the wrong secret", () => {
    const payload = Buffer.from("Hello, World!");
    const signature = githubSignature256(payload, "It's a Secret to Everybody");
    assert.equal(verifyGitHubSignature(payload, signature, "nope"), false);
  });

  it("rejects a missing header", () => {
    assert.equal(verifyGitHubSignature(Buffer.from("{}"), undefined, "secret"), false);
  });

  it("does not throw on a truncated header (length mismatch)", () => {
    const payload = Buffer.from("{}");
    const signature = githubSignature256(payload, "secret");
    assert.equal(
      verifyGitHubSignature(payload, signature.slice(0, 10), "secret"),
      false,
    );
  });
});
