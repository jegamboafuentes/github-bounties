import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "../ids";

export const WITHDRAW_TOKEN_TTL_MS = 5 * 60 * 1000;

export type WithdrawTokenClaims = {
  id: string;
  amountAtomic: string;
  destination: string;
  network: string;
  adminEmail: string;
  exp: number;
};

/** Stored form of the confirm token. The raw token is not written to the database. */
export function hashWithdrawToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueWithdrawToken(
  claims: Omit<WithdrawTokenClaims, "exp">,
  secret: string,
  nowMs: number,
): { token: string; expiresAt: Date } {
  const exp = nowMs + WITHDRAW_TOKEN_TTL_MS;
  const payload = JSON.stringify({ ...claims, exp });
  const token = `${Buffer.from(payload).toString("base64url")}.${sign(payload, secret)}`;
  return { token, expiresAt: new Date(exp) };
}

export function readWithdrawToken(
  token: string,
  secret: string,
  nowMs: number,
): WithdrawTokenClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(payload, secret);
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  let parsed: WithdrawTokenClaims;
  try {
    parsed = JSON.parse(payload) as WithdrawTokenClaims;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.exp !== "number" || parsed.exp <= nowMs) return null;
  if (
    typeof parsed.id !== "string" ||
    !isUuid(parsed.id) ||
    typeof parsed.amountAtomic !== "string" ||
    typeof parsed.destination !== "string" ||
    typeof parsed.network !== "string" ||
    typeof parsed.adminEmail !== "string"
  ) {
    return null;
  }
  return parsed;
}
