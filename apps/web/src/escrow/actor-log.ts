import { randomUUID } from "node:crypto";

/** Money actions that emit one Cloud Logging JSON line. No emails, tokens, or signatures. */
export type MoneyAction =
  | "lock"
  | "top_up"
  | "settle"
  | "winner_claim"
  | "pool_claim"
  | "refund"
  | "fee_transfer";

export type MoneyActionLog = {
  action: MoneyAction;
  actorUserId: string | null;
  bountyId: string;
  contributionId?: string | null;
  claimId?: string | null;
  destination?: string | null;
  amountUsdc?: string | null;
  txHash?: string | null;
  result: "ok" | string;
  requestId: string;
};

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

/** Use a caller request id only when it is a short token. Otherwise mint one. */
export function takeRequestId(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (REQUEST_ID_RE.test(trimmed)) return trimmed;
  return randomUUID();
}

/**
 * One structured line per money action. Cloud Logging picks up stdout.
 * Fields are an allowlist so a caller cannot attach secrets.
 */
export function logMoneyAction(entry: MoneyActionLog): void {
  const line = {
    event: "money_action",
    action: entry.action,
    actorUserId: entry.actorUserId,
    bountyId: entry.bountyId,
    contributionId: entry.contributionId ?? null,
    claimId: entry.claimId ?? null,
    destination: entry.destination ?? null,
    amountUsdc: entry.amountUsdc ?? null,
    txHash: entry.txHash ?? null,
    result: entry.result,
    requestId: entry.requestId,
  };
  console.log(JSON.stringify(line));
}

export function moneyResultCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return "error";
}
