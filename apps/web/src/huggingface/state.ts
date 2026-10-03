import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "../auth/env";

export type HfConnectState = {
  userId: string;
  nonce: string;
  exp: number;
  /** SHA-256 of the PKCE verifier. The verifier itself stays in an httpOnly cookie. */
  pkceHash: string;
};

const MAX_AGE_SECONDS = 30 * 60;

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function pkceHash(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function signHfConnectState(
  input: { userId: string; pkceHash: string; now?: number },
  secret = resolveAuthSecret(),
): string {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: HfConnectState = {
    userId: input.userId,
    nonce: randomBytes(16).toString("hex"),
    exp: now + MAX_AGE_SECONDS,
    pkceHash: input.pkceHash,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyHfConnectState(
  raw: string | null | undefined,
  secret = resolveAuthSecret(),
  now = Date.now(),
): HfConnectState | null {
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(mac, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HfConnectState;
    if (!parsed.userId || !parsed.nonce || !parsed.pkceHash || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp < Math.floor(now / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pkceHashesMatch(verifier: string, expectedHash: string): boolean {
  const actual = Buffer.from(pkceHash(verifier), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
