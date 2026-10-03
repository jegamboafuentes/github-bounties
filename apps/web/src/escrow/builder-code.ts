import { Attribution } from "ox/erc8021";
import { concat, encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import type { EnvMap } from "./env";

/** Public base.dev builder code. Not a secret. Unset means no calldata suffix. */
export const BASE_BUILDER_CODE_ENV = "BASE_BUILDER_CODE";

/** Same pattern the x402 builder-code extension requires. */
export const BUILDER_CODE_PATTERN = /^[a-z0-9_]{1,32}$/;

/** ERC-8021 marker: 0x8021 repeated eight times (16 bytes). */
export const ERC8021_SUFFIX_MARKER = "80218021802180218021802180218021";

export class BuilderCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuilderCodeError";
  }
}

export type CdpTransferNetwork = "base" | "base-sepolia";

export type UsdcSendRequest = {
  network: CdpTransferNetwork;
  transaction: { to: `0x${string}`; data: Hex };
  idempotencyKey: string;
};

/**
 * Blank or missing is unset (null). A non-empty value that fails the pattern throws
 * so a typo cannot send unattributed USDC while looking configured.
 */
export function readBuilderCode(env: EnvMap = process.env): string | null {
  const raw = env[BASE_BUILDER_CODE_ENV];
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (!code) return null;
  if (!BUILDER_CODE_PATTERN.test(code)) {
    throw new BuilderCodeError(
      "BASE_BUILDER_CODE must match ^[a-z0-9_]{1,32}$.",
    );
  }
  return code;
}

/** Schema 0 suffix from ox, or `0x` when no code is configured. */
export function builderCodeDataSuffix(env: EnvMap = process.env): Hex {
  const code = readBuilderCode(env);
  if (!code) return "0x";
  return Attribution.toDataSuffix({ codes: [code] }) as Hex;
}

/**
 * ERC-20 `transfer(to, amount)`. With a builder code, the Schema 0 suffix is
 * appended. Contracts ignore the extra bytes. Unset, the bytes match a plain transfer.
 */
export function encodeUsdcTransferData(to: string, amount: bigint, env: EnvMap = process.env): Hex {
  const call = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), amount],
  });
  const suffix = builderCodeDataSuffix(env);
  if (suffix === "0x") return call;
  return concat([call, suffix]);
}

export function buildUsdcSendTransaction(input: {
  to: string;
  amountAtomic: bigint;
  token: `0x${string}`;
  network: CdpTransferNetwork;
  idempotencyKey: string;
  env?: EnvMap;
}): UsdcSendRequest {
  return {
    network: input.network,
    transaction: {
      to: input.token,
      data: encodeUsdcTransferData(input.to, input.amountAtomic, input.env),
    },
    idempotencyKey: input.idempotencyKey,
  };
}

/**
 * Encode the transfer and send it. The idempotency key is an argument
 * `sendTransaction` forwards to CDP. `account.transfer()` did not.
 */
export async function sendUsdcTransfer(
  sendTransaction: (args: UsdcSendRequest) => Promise<{ transactionHash?: string }>,
  input: {
    to: string;
    amountAtomic: bigint;
    token: `0x${string}`;
    network: CdpTransferNetwork;
    idempotencyKey: string;
    env?: EnvMap;
  },
): Promise<{ transactionHash?: string }> {
  return sendTransaction(buildUsdcSendTransaction(input));
}
