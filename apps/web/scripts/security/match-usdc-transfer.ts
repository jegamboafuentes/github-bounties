import {
  decodeEventLog,
  erc20Abi,
  getAddress,
  type Hex,
} from "viem";

/**
 * ERC-20 Transfer(address indexed from, address indexed to, uint256 value).
 * Circle USDC on Base uses this layout. Logs from any other contract are ignored.
 */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type TxLog = {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex: number;
};

export type TransferEvidence = {
  logIndex: number;
  contract: string;
  from: string;
  to: string;
  amountAtomic: bigint;
};

export type MatchRefusalCode =
  | "no_matching_log"
  | "multiple_matches"
  | "wrong_token"
  | "sender_is_escrow"
  | "reverted_tx"
  | "invalid_escrow_address";

export type MatchResult =
  | { ok: true; evidence: TransferEvidence }
  | { ok: false; code: MatchRefusalCode; detail: string };

export function isChainTxHash(value: string | null | undefined): value is string {
  return Boolean(value && TX_HASH_RE.test(value.trim()));
}

function checksum(value: string): string | null {
  try {
    return getAddress(value.trim() as Hex);
  } catch {
    return null;
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function decodeTransfer(log: TxLog): { from: string; to: string; value: bigint } | null {
  const topic0 = log.topics[0];
  const topic1 = log.topics[1];
  const topic2 = log.topics[2];
  if (!topic0 || !topic1 || !topic2) return null;
  if (topic0.toLowerCase() !== TRANSFER_TOPIC) return null;
  try {
    const decoded = decodeEventLog({
      abi: erc20Abi,
      eventName: "Transfer",
      data: log.data as Hex,
      topics: [topic0 as Hex, topic1 as Hex, topic2 as Hex],
    });
    if (decoded.eventName !== "Transfer") return null;
    return {
      from: getAddress(decoded.args.from),
      to: getAddress(decoded.args.to),
      value: decoded.args.value,
    };
  } catch {
    return null;
  }
}

/**
 * Pick the single configured-USDC Transfer into the escrow wallet for the
 * recorded atomic amount. The Transfer `from` is the verified sender.
 *
 * A lookalike token that copies the Transfer signature is not a match.
 * Zero matches, two or more USDC matches, or a sender equal to the escrow
 * wallet all refuse. Unrelated logs (other amounts, other recipients,
 * other events) are ignored.
 */
export function matchEscrowUsdcTransfer(input: {
  logs: readonly TxLog[];
  usdcContract: string;
  escrowWallet: string;
  amountAtomic: bigint;
  receiptStatus?: "success" | "reverted";
}): MatchResult {
  if (input.receiptStatus === "reverted") {
    return {
      ok: false,
      code: "reverted_tx",
      detail: "Transaction receipt status is reverted.",
    };
  }
  const usdc = checksum(input.usdcContract);
  if (!usdc) {
    throw new Error("Configured USDC contract is not an address.");
  }
  const escrow = checksum(input.escrowWallet);
  if (!escrow) {
    return {
      ok: false,
      code: "invalid_escrow_address",
      detail: "escrow_address is not a Base address.",
    };
  }
  if (input.amountAtomic <= BigInt(0)) {
    return {
      ok: false,
      code: "no_matching_log",
      detail: "Recorded amount must be positive.",
    };
  }

  const matches: TransferEvidence[] = [];
  const lookalikes: string[] = [];
  for (const log of input.logs) {
    const decoded = decodeTransfer(log);
    if (!decoded) continue;
    if (!sameAddress(decoded.to, escrow)) continue;
    if (decoded.value !== input.amountAtomic) continue;
    const contract = checksum(log.address);
    if (!contract) continue;
    if (!sameAddress(contract, usdc)) {
      lookalikes.push(contract);
      continue;
    }
    matches.push({
      logIndex: log.logIndex,
      contract,
      from: decoded.from,
      to: decoded.to,
      amountAtomic: decoded.value,
    });
  }

  if (matches.length === 0) {
    if (lookalikes.length > 0) {
      return {
        ok: false,
        code: "wrong_token",
        detail: `Transfer to the escrow wallet for the recorded amount was emitted by ${lookalikes.join(", ")}, not the configured USDC ${usdc}.`,
      };
    }
    return {
      ok: false,
      code: "no_matching_log",
      detail: "No configured-USDC Transfer to the escrow wallet for the recorded amount.",
    };
  }
  if (matches.length > 1) {
    const indexes = matches.map((row) => row.logIndex).join(", ");
    return {
      ok: false,
      code: "multiple_matches",
      detail: `Configured USDC transfers to the escrow wallet for the recorded amount appear at log indexes ${indexes}.`,
    };
  }
  const match = matches[0];
  if (!match) {
    return {
      ok: false,
      code: "no_matching_log",
      detail: "No configured-USDC Transfer to the escrow wallet for the recorded amount.",
    };
  }
  if (sameAddress(match.from, escrow)) {
    return {
      ok: false,
      code: "sender_is_escrow",
      detail: "The only matching Transfer is from the escrow wallet itself.",
    };
  }
  return { ok: true, evidence: match };
}
