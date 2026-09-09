import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "../auth/env";

export type GitHubConnectState = {
  userId: string;
  nonce: string;
  exp: number;
  installationId?: string;
};

const MAX_AGE_SECONDS = 30 * 60;

export function signGitHubConnectState(
  input: { userId: string; installationId?: string; now?: number },
  secret = resolveAuthSecret(),
): string {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: GitHubConnectState = {
    userId: input.userId,
    nonce: randomBytes(16).toString("hex"),
    exp: now + MAX_AGE_SECONDS,
  };
  if (input.installationId) payload.installationId = input.installationId;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyGitHubConnectState(
  raw: string | null | undefined,
  secret = resolveAuthSecret(),
  now = Date.now(),
): GitHubConnectState | null {
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(mac, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GitHubConnectState;
    if (!parsed.userId || !parsed.nonce || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp < Math.floor(now / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
