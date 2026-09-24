import { atomicToUsdc } from "../../src/lib/money";
import { verifiedTopUpHashes, withVerifiedTopUpHash } from "../../src/escrow/payout-guard";
import type { TransferEvidence } from "./match-usdc-transfer";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChainStamp = {
  chainId: number;
  chainName: string;
  usdcContract: string;
  network: string;
};

export type CitedEvidence = TransferEvidence & {
  txHash: string;
  blockNumber: bigint;
};

export type Refusal = {
  bountyId: string;
  escrowId: string;
  kind: "funder_address" | "x402_topup_marker";
  txHash: string | null;
  code: string;
  detail: string;
};

export type FunderUpdate = {
  escrowId: string;
  bountyId: string;
  fundTxHash: string;
  funderAddress: string;
  escrowAddress: string;
  amountSource: "contribution" | "escrow_face";
  evidence: CitedEvidence;
};

export type MarkerContribution = {
  contributionId: string;
  fundTxHash: string;
  evidence: CitedEvidence;
};

export type MarkerUpdate = {
  escrowId: string;
  bountyId: string;
  previousPaymentId: string;
  nextPaymentId: string;
  contributions: MarkerContribution[];
};

/**
 * Amount credited by the recorded fund tx. A later top-up increases
 * `escrows.amount_usdc` to the face total, so the contribution row that
 * shares the tx hash is the amount that must match the Transfer.
 */
export function recordedCreditUsdc(
  contributionAmount: string | null | undefined,
  escrowAmount: string,
): { usdc: string; source: "contribution" | "escrow_face" } {
  const contribution = contributionAmount?.trim() ?? "";
  if (contribution) return { usdc: contribution, source: "contribution" };
  const face = escrowAmount.trim();
  if (!face) throw new Error("Recorded USDC amount is empty.");
  return { usdc: face, source: "escrow_face" };
}

/**
 * Q3 shape: a live contribution hash is missing the top-up marker when it
 * is not the escrow lock hash and `x402-topup:<hash>` is not already a line
 * of `escrows.x402_payment_id` (same parser as Claim).
 */
export function contributionNeedsTopUpMarker(input: {
  contributionFundTxHash: string;
  escrowFundTxHash: string | null;
  x402PaymentId: string | null;
}): boolean {
  const hash = input.contributionFundTxHash.trim();
  if (!hash || hash.startsWith("mock:") || hash.startsWith("sepolia-dry-run:")) return false;
  const lock = input.escrowFundTxHash?.trim() || "";
  if (lock && lock.toLowerCase() === hash.toLowerCase()) return false;
  return !verifiedTopUpHashes(input.x402PaymentId).some(
    (row) => row.toLowerCase() === hash.toLowerCase(),
  );
}

export function planMarkerUpdate(input: {
  escrowId: string;
  bountyId: string;
  previousPaymentId: string | null;
  contributions: MarkerContribution[];
}): MarkerUpdate {
  const previous = input.previousPaymentId?.trim() ?? "";
  if (!previous) {
    throw new Error("Refusing to create an x402_payment_id. Marker fixes only append to an existing id.");
  }
  if (input.contributions.length === 0) {
    throw new Error("Refusing to render a marker update with no verified contribution.");
  }
  const contributions = [...input.contributions].sort((a, b) =>
    a.contributionId.localeCompare(b.contributionId),
  );
  const nextPaymentId = contributions.reduce(
    (paymentId, row) => withVerifiedTopUpHash(paymentId, row.fundTxHash.trim()),
    previous,
  );
  return {
    escrowId: input.escrowId,
    bountyId: input.bountyId,
    previousPaymentId: previous,
    nextPaymentId,
    contributions,
  };
}

function sqlString(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Refusing a SQL literal that contains NUL.");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlComment(text: string): string {
  return `-- ${text.replace(/[\r\n]+/g, " ")}`;
}

function requireUuid(value: string, label: string): string {
  const trimmed = value.trim();
  if (!UUID_RE.test(trimmed)) {
    throw new Error(`Refusing to render ${label}: id is not a UUID.`);
  }
  return trimmed;
}

function evidenceComment(evidence: CitedEvidence, usdcContract: string): string {
  return sqlComment(
    [
      `evidence tx_hash=${evidence.txHash}`,
      `block=${evidence.blockNumber.toString()}`,
      `log_index=${evidence.logIndex}`,
      `from=${evidence.from}`,
      `to=${evidence.to}`,
      `amount_atomic=${evidence.amountAtomic.toString()}`,
      `amount_usdc=${atomicToUsdc(evidence.amountAtomic)}`,
      `usdc_contract=${usdcContract}`,
    ].join(" "),
  );
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function renderFunderUpdate(update: FunderUpdate, usdcContract: string): string {
  if (sameAddress(update.funderAddress, update.escrowAddress)) {
    throw new Error("Refusing to render a funder_address equal to the escrow wallet.");
  }
  const escrowId = requireUuid(update.escrowId, "escrow id");
  const bountyId = requireUuid(update.bountyId, "bounty id");
  return [
    sqlComment(
      `funder_address correction bounty_id=${bountyId} escrow_id=${escrowId} amount_source=${update.amountSource}`,
    ),
    sqlComment(
      "sender is the Transfer from of the recorded fund tx. Not a poster wallet and not a hand-typed address.",
    ),
    evidenceComment(update.evidence, usdcContract),
    "UPDATE escrows",
    `SET funder_address = ${sqlString(update.funderAddress)},`,
    "    updated_at = now()",
    `WHERE id = ${sqlString(escrowId)}`,
    "  AND lower(btrim(funder_address)) = lower(btrim(escrow_address))",
    `  AND lower(btrim(escrow_address)) = lower(${sqlString(update.escrowAddress)})`,
    `  AND fund_tx_hash = ${sqlString(update.fundTxHash)};`,
  ].join("\n");
}

function renderMarkerUpdate(update: MarkerUpdate, usdcContract: string): string {
  const escrowId = requireUuid(update.escrowId, "escrow id");
  const bountyId = requireUuid(update.bountyId, "bounty id");
  if (!update.previousPaymentId.trim()) {
    throw new Error("Refusing to render a marker update without an existing x402_payment_id.");
  }
  const lines = [
    sqlComment(
      `x402-topup marker bounty_id=${bountyId} escrow_id=${escrowId} stored format is the existing payment id plus one x402-topup:<hash> line per verified contribution`,
    ),
  ];
  const exists: string[] = [];
  for (const row of update.contributions) {
    const contributionId = requireUuid(row.contributionId, "contribution id");
    const hash = row.fundTxHash.trim();
    const marker = `x402-topup:${hash}`;
    const appended = update.nextPaymentId
      .split("\n")
      .some((line) => line.trim().toLowerCase() === marker.toLowerCase());
    if (!appended) {
      throw new Error("Refusing to render a marker update that does not append x402-topup:<hash>.");
    }
    lines.push(sqlComment(`contribution_id=${contributionId} append ${marker}`));
    lines.push(evidenceComment(row.evidence, usdcContract));
    exists.push(
      [
        "  AND EXISTS (",
        "    SELECT 1 FROM bounty_contributions c",
        "    WHERE c.bounty_id = escrows.bounty_id",
        `      AND c.id = ${sqlString(contributionId)}`,
        `      AND c.fund_tx_hash = ${sqlString(hash)}`,
        "  )",
      ].join("\n"),
    );
  }
  lines.push(
    "UPDATE escrows",
    `SET x402_payment_id = ${sqlString(update.nextPaymentId)},`,
    "    updated_at = now()",
    `WHERE id = ${sqlString(escrowId)}`,
    `  AND x402_payment_id IS NOT DISTINCT FROM ${sqlString(update.previousPaymentId)}`,
    ...exists,
    ";",
  );
  return lines.join("\n");
}

function renderRefusal(refusal: Refusal): string {
  const tx = refusal.txHash?.trim() || "none";
  return [
    sqlComment(
      `refused ${refusal.kind} bounty_id=${refusal.bountyId} escrow_id=${refusal.escrowId} tx_hash=${tx} code=${refusal.code}`,
    ),
    sqlComment(refusal.detail),
    sqlComment("No UPDATE for this row."),
  ].join("\n");
}

/**
 * Review SQL only. Caller prints it. Nothing here connects to a database.
 * The trailer is always ROLLBACK so pasting the script does not commit.
 */
export function renderCorrectionScript(input: {
  chain: ChainStamp;
  funderUpdates: FunderUpdate[];
  markerUpdates: MarkerUpdate[];
  refusals: Refusal[];
}): string {
  const funderUpdates = [...input.funderUpdates].sort((a, b) =>
    a.bountyId.localeCompare(b.bountyId),
  );
  const markerUpdates = [...input.markerUpdates].sort((a, b) =>
    a.bountyId.localeCompare(b.bountyId),
  );
  const refusals = [...input.refusals].sort((a, b) => a.bountyId.localeCompare(b.bountyId));
  const body = [
    ...refusals.map(renderRefusal),
    ...funderUpdates.map((row) => renderFunderUpdate(row, input.chain.usdcContract)),
    ...markerUpdates.map((row) => renderMarkerUpdate(row, input.chain.usdcContract)),
  ];
  if (body.length === 0) {
    body.push("-- No funder_address or x402-topup corrections to propose.");
  }
  return [
    "-- derive-funder-corrections (read-only)",
    `-- chain_id=${input.chain.chainId} chain=${input.chain.chainName} network=${input.chain.network}`,
    `-- usdc_contract=${input.chain.usdcContract}`,
    "-- The tool read Postgres and transaction receipts. It did not execute this script.",
    "-- funder_address must be the on-chain Transfer from of the recorded fund tx.",
    "-- Never the poster's saved wallet, a contribution-funder fallback, or a hand-typed address.",
    "-- Apply on PROD only after the owner approves this output. The trailer is ROLLBACK.",
    "BEGIN;",
    "",
    body.join("\n\n"),
    "",
    "ROLLBACK;",
    "-- End of proposal. Nobody runs UPDATEs on PROD without the owner's OK.",
    "",
  ].join("\n");
}
