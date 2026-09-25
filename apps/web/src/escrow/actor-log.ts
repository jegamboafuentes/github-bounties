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
  /** Outbound transfers (settle, claim, refund, fee). Not set on inbound lock / top_up. */
  destination?: string | null;
  /** Inbound lock / top_up payer. Not set on outbound transfers. */
  payer?: string | null;
  amountUsdc?: string | null;
  txHash?: string | null;
  result: "ok" | string;
  requestId: string;
  /** API key that initiated the call. Absent for website and webhook actions. */
  apiKeyId?: string | null;
  /** WINNER_PAYOUT, POOL_PAYOUT, or REFUND_OUT when the API names the leg. */
  leg?: string | null;
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
const INBOUND_ACTIONS = new Set<MoneyAction>(["lock", "top_up"]);

export function logMoneyAction(entry: MoneyActionLog): void {
  const inbound = INBOUND_ACTIONS.has(entry.action);
  const line: Record<string, unknown> = {
    event: "money_action",
    action: entry.action,
    actorUserId: entry.actorUserId,
    bountyId: entry.bountyId,
    contributionId: entry.contributionId ?? null,
    claimId: entry.claimId ?? null,
    amountUsdc: entry.amountUsdc ?? null,
    txHash: entry.txHash ?? null,
    result: entry.result,
    requestId: entry.requestId,
    ...(entry.apiKeyId ? { apiKeyId: entry.apiKeyId } : {}),
    ...(entry.leg ? { leg: entry.leg } : {}),
  };
  if (inbound) line.payer = entry.payer ?? null;
  else line.destination = entry.destination ?? null;
  console.log(JSON.stringify(line));
}

export function moneyResultCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return "error";
}
