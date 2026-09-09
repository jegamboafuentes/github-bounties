import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { signGitHubAppJwt } from "./jwt";

describe("GitHub App JWT", () => {
  it("signs RS256 with a generated key (never a production secret)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = signGitHubAppJwt("12345", pem, 1_778_000_000_000);
    const [header, payload, signature] = jwt.split(".");
    assert.ok(header && payload && signature);
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      iss: string;
      iat: number;
      exp: number;
    };
    assert.equal(decoded.iss, "12345");
    assert.ok(decoded.exp > decoded.iat);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    assert.equal(verifier.verify(publicKey, signature, "base64url"), true);
  });
});
