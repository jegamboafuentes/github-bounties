import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 header value GitHub sends as `X-Hub-Signature-256`. */
export function githubSignature256(
  rawBody: Buffer | string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

/**
 * Verify a GitHub webhook delivery.
 *
 * GitHub signs the **raw request body bytes** with HMAC-SHA256 and the webhook
 * secret, then sends `X-Hub-Signature-256: sha256=<hex>`.
 *
 * Compare in constant time. Never parse JSON before hashing — re-serialization
 * changes bytes and the signature will not match.
 *
 * Official test vector (docs.github.com, Validating webhook deliveries):
 * - secret: `It's a Secret to Everybody`
 * - payload: `Hello, World!`
 * - header: `sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17`
 */
export function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }
  const expected = githubSignature256(rawBody, secret);
  const actual = signatureHeader.trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
