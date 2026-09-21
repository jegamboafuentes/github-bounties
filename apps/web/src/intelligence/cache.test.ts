import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cacheIsFresh,
  INTELLIGENCE_ERROR_TTL_MS,
  INTELLIGENCE_TTL_MS,
  intelligenceFingerprint,
} from "./cache";

describe("intelligence cache", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  const fingerprint = intelligenceFingerprint({
    issueBody: "fix it",
    repoAbout: "lib",
    languages: ["TypeScript"],
    readmeBlurb: "# hi",
  });

  it("changes fingerprint when issue body or repo metadata changes", () => {
    const other = intelligenceFingerprint({
      issueBody: "fix it harder",
      repoAbout: "lib",
      languages: ["TypeScript"],
      readmeBlurb: "# hi",
    });
    assert.notEqual(fingerprint, other);
    assert.equal(fingerprint.length, 64);
  });

  it("treats ready rows as fresh inside the 7d TTL and stale after", () => {
    assert.equal(
      cacheIsFresh({
        row: {
          status: "ready",
          generatedAt: new Date(now.getTime() - 60_000),
          sourceFingerprint: fingerprint,
        },
        fingerprint,
        now,
      }),
      true,
    );
    assert.equal(
      cacheIsFresh({
        row: {
          status: "ready",
          generatedAt: new Date(now.getTime() - INTELLIGENCE_TTL_MS - 1),
          sourceFingerprint: fingerprint,
        },
        fingerprint,
        now,
      }),
      false,
    );
  });

  it("uses a shorter TTL for errors and invalidates on fingerprint mismatch", () => {
    assert.equal(
      cacheIsFresh({
        row: {
          status: "error",
          generatedAt: new Date(now.getTime() - 1_000),
          sourceFingerprint: fingerprint,
        },
        fingerprint,
        now,
      }),
      true,
    );
    assert.equal(
      cacheIsFresh({
        row: {
          status: "error",
          generatedAt: new Date(now.getTime() - INTELLIGENCE_ERROR_TTL_MS - 1),
          sourceFingerprint: fingerprint,
        },
        fingerprint,
        now,
      }),
      false,
    );
    assert.equal(
      cacheIsFresh({
        row: {
          status: "ready",
          generatedAt: now,
          sourceFingerprint: "other",
        },
        fingerprint,
        now,
      }),
      false,
    );
  });
});
