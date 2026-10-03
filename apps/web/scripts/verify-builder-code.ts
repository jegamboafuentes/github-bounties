/**
 * Decode a Base Sepolia (or mainnet) transaction and check the builder-code suffix.
 *
 *   npm run verify:builder-code -- 0x<txhash>
 *   npm run verify:builder-code -- 0x<txhash> --network base
 *
 * Fund txs are ERC-3009 transferWithAuthorization (Schema 2, field `a`).
 * Payout, refund, and fee-withdraw txs are ERC-20 transfer (Schema 0 codes).
 * The expected code defaults to bc_u97ii222. Override with --code or BASE_BUILDER_CODE.
 */
import { parseBuilderCodeSuffixFromCalldata } from "@x402/extensions/builder-code";
import { pathToFileURL } from "node:url";
import { Attribution } from "ox/erc8021";
import type { Hex } from "viem";

const TRANSFER_SELECTOR = "0xa9059cbb";
const TRANSFER_WITH_AUTHORIZATION_SELECTOR = "0xe3ee160e";
const DEFAULT_CODE = "bc_u97ii222";

export type BuilderCodeInspection = {
  hash?: string;
  network: string;
  selector: string;
  kind: "schema0-transfer" | "schema2-transferWithAuthorization" | "unknown";
  schema0?: { codes: string[]; id?: number };
  schema2?: { a?: string; w?: string; s?: string | string[] };
  contains: boolean;
  expected: string;
};

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

export function expectedBuilderCode(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  return argValue(argv, "--code")?.trim() || env.BASE_BUILDER_CODE?.trim() || DEFAULT_CODE;
}

export function rpcUrlForNetwork(network: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.BASE_RPC_URL?.trim()) return env.BASE_RPC_URL.trim();
  if (network === "base" || network === "base-mainnet" || network === "eip155:8453") {
    return "https://mainnet.base.org";
  }
  return "https://sepolia.base.org";
}

export function inspectBuilderCodeCalldata(input: Hex, expected: string, network = "base-sepolia"): BuilderCodeInspection {
  const selector = input.slice(0, 10).toLowerCase();
  if (selector === TRANSFER_SELECTOR) {
    const parsed = Attribution.fromData(input);
    const codes = parsed?.codes ?? [];
    return {
      network,
      selector,
      kind: "schema0-transfer",
      schema0: { codes, id: parsed?.id },
      contains: codes.includes(expected),
      expected,
    };
  }
  if (selector === TRANSFER_WITH_AUTHORIZATION_SELECTOR) {
    const parsed = parseBuilderCodeSuffixFromCalldata(input);
    return {
      network,
      selector,
      kind: "schema2-transferWithAuthorization",
      schema2: parsed,
      contains: parsed?.a === expected,
      expected,
    };
  }
  return { network, selector, kind: "unknown", contains: false, expected };
}

async function fetchTransactionInput(hash: string, rpcUrl: string): Promise<Hex> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionByHash",
      params: [hash],
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status} from ${rpcUrl}`);
  }
  const body = (await response.json()) as { error?: { message?: string }; result?: { input?: string } | null };
  if (body.error) throw new Error(body.error.message || "RPC error");
  const input = body.result?.input;
  if (!input || input === "0x") throw new Error(`No input for ${hash}`);
  return input as Hex;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const hash = argv.find((arg) => arg.startsWith("0x") && arg.length === 66);
  if (!hash) {
    console.error("Usage: npm run verify:builder-code -- 0x<txhash> [--network base-sepolia|base] [--code bc_u97ii222]");
    process.exit(2);
  }
  const network = argValue(argv, "--network") ?? "base-sepolia";
  const expected = expectedBuilderCode(argv);
  const rpcUrl = rpcUrlForNetwork(network);
  const input = await fetchTransactionInput(hash, rpcUrl);
  const inspection = { ...inspectBuilderCodeCalldata(input, expected, network), hash };
  console.log(JSON.stringify(inspection, null, 2));
  if (!inspection.contains) process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
