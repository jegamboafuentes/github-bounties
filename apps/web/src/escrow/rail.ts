import { createHash } from "node:crypto";
import {
  CDP_DEFAULT_NETWORK,
  CDP_ESCROW_ACCOUNT_NAME,
  CDP_FEE_ACCOUNT_NAME,
} from "../lib/constants";
import { EscrowError } from "./errors";
import {
  cdpMissingEnvMessage,
  isDryRunLive,
  isMainnetAllowed,
  probeCdpEnv,
  type CdpProbe,
  type CdpRailMode,
  type EnvMap,
} from "./env";
import type { MoneyKind } from "./state";

export type { CdpRailMode };

export type RailTransferPurpose = "fund" | "hunter" | "fee" | "refund";

export type RailTransferInput = {
  to: string;
  amountAtomic: bigint;
  idempotencyKey: string;
  purpose: RailTransferPurpose;
  kind: MoneyKind;
};

export type RailTransferResult = {
  txHash: string;
};

export type RailWallets = {
  escrowAddress: string;
  feeAddress: string;
};

export type CdpRail = {
  mode: CdpRailMode;
  network: string;
  missingEnv: string[];
  probe: CdpProbe;
  ensureWallets(): Promise<RailWallets>;
  /**
   * Credit face F into gb-escrow (lock). Mock always succeeds.
   * Live + CDP_DRY_RUN_LIVE faucets Sepolia test USDC.
   * Live without inbound confirmation throws `inbound_unconfirmed`.
   */
  lockFace(input: {
    amountAtomic: bigint;
    idempotencyKey: string;
    fundTxHash?: string | null;
  }): Promise<RailTransferResult & RailWallets>;
  transferUsdc(input: RailTransferInput): Promise<RailTransferResult>;
};

export const MOCK_ESCROW_ADDRESS = "0x00000000000000000000000000000000e5c400";
export const MOCK_FEE_ADDRESS = "0x00000000000000000000000000000000fee200";

export function mockTxHash(purpose: string, idempotencyKey: string): string {
  const hex = createHash("sha256").update(`mock:${purpose}:${idempotencyKey}`).digest("hex");
  return `mock:0x${hex}`;
}

export function createMockRail(
  probe: CdpProbe = probeCdpEnv({}),
): CdpRail {
  const wallets: RailWallets = {
    escrowAddress: MOCK_ESCROW_ADDRESS,
    feeAddress: MOCK_FEE_ADDRESS,
  };
  return {
    mode: "mock",
    network: probe.network || CDP_DEFAULT_NETWORK,
    missingEnv: probe.missing,
    probe: { ...probe, mode: "mock" },
    async ensureWallets() {
      return wallets;
    },
    async lockFace(input) {
      return {
        ...wallets,
        txHash: input.fundTxHash?.trim() || mockTxHash("fund", input.idempotencyKey),
      };
    },
    async transferUsdc(input) {
      return { txHash: mockTxHash(input.purpose, input.idempotencyKey) };
    },
  };
}

type LiveAccount = {
  address: string;
  transfer?: (args: {
    to: string;
    amount: bigint;
    token: string;
    network: string;
    idempotencyKey?: string;
  }) => Promise<{ transactionHash?: string }>;
};

type CdpSdkModule = {
  CdpClient: new () => {
    evm: {
      getOrCreateAccount: (args: { name: string }) => Promise<LiveAccount>;
      requestFaucet?: (args: {
        address: string;
        network: string;
        token: string;
      }) => Promise<{ transactionHash?: string }>;
    };
  };
};

/**
 * Live CDP server-wallet client. Literal `import()` so Next standalone
 * file-tracing copies `@coinbase/cdp-sdk` into the Cloud Run image.
 * Mock-rail tests never construct CdpClient.
 *
 * Cast through `unknown` — the published SDK types are stricter (`0x${string}`
 * addresses) than this rail's stringly `LiveAccount` surface.
 */
async function loadCdpSdk(): Promise<CdpSdkModule> {
  return (await import("@coinbase/cdp-sdk")) as unknown as CdpSdkModule;
}

/**
 * Live CDP server-wallet rail. Dynamic-imports `@coinbase/cdp-sdk` (a
 * runtime dependency of apps/web). Secrets stay in env; never logged.
 */
export function createCdpRail(env: EnvMap = process.env, probe = probeCdpEnv(env)): CdpRail {
  if (probe.unsafeNetwork && !isMainnetAllowed(env)) {
    throw new EscrowError(
      "mainnet_refused",
      `CDP_NETWORK=${probe.network} looks like mainnet. Refusing real USDC prod spend. Default is base-sepolia. Set CDP_NETWORK=base and CDP_ALLOW_MAINNET=1 only for an explicit prod go-live.`,
      { details: { network: probe.network } },
    );
  }
  if (probe.missing.length) {
    throw new EscrowError("missing_cdp_env", cdpMissingEnvMessage(probe.missing), {
      missing: probe.missing,
    });
  }

  let cached: (RailWallets & { escrow: LiveAccount }) | undefined;

  async function loadWallets(): Promise<RailWallets & { escrow: LiveAccount }> {
    if (cached) return cached;
    let CdpClient: new () => {
      evm: {
        getOrCreateAccount: (args: { name: string }) => Promise<LiveAccount>;
        requestFaucet?: (args: {
          address: string;
          network: string;
          token: string;
        }) => Promise<{ transactionHash?: string }>;
      };
    };
    try {
      ({ CdpClient } = await loadCdpSdk());
    } catch (err) {
      if (err instanceof EscrowError) throw err;
      throw new EscrowError(
        "cdp_sdk_missing",
        "Live CDP rail needs @coinbase/cdp-sdk. Install it in the runtime image after Ops stashes CDP_* in Secret Manager. See docs/escrow.md.",
      );
    }
    const cdp = new CdpClient();
    const escrow = await cdp.evm.getOrCreateAccount({ name: CDP_ESCROW_ACCOUNT_NAME });
    const fee = await cdp.evm.getOrCreateAccount({ name: CDP_FEE_ACCOUNT_NAME });
    cached = {
      escrowAddress: escrow.address,
      feeAddress: fee.address,
      escrow,
    };
    if (isDryRunLive(env) && !probe.unsafeNetwork && cdp.evm.requestFaucet) {
      await cdp.evm.requestFaucet({
        address: escrow.address,
        network: "base-sepolia",
        token: "usdc",
      });
    }
    return cached;
  }

  return {
    mode: "cdp",
    network: probe.network,
    missingEnv: [],
    probe: { ...probe, mode: "cdp" },
    async ensureWallets() {
      const wallets = await loadWallets();
      return { escrowAddress: wallets.escrowAddress, feeAddress: wallets.feeAddress };
    },
    async lockFace(input) {
      const wallets = await loadWallets();
      if (input.fundTxHash?.trim()) {
        return { ...wallets, txHash: input.fundTxHash.trim() };
      }
      if (isDryRunLive(env) && !probe.unsafeNetwork) {
        return {
          ...wallets,
          txHash: mockTxHash("cdp-dry-run-live-fund", input.idempotencyKey).replace(
            "mock:",
            "sepolia-dry-run:",
          ),
        };
      }
      throw new EscrowError(
        "inbound_unconfirmed",
        `Send face USDC to gb-escrow (${wallets.escrowAddress}) on ${probe.network}, then retry fund with the on-chain tx hash. Hosted checkout is disabled (ADR 0001 fee-skim open Q). Direct transfer / x402 exact only.`,
        { details: { escrowAddress: wallets.escrowAddress, network: probe.network } },
      );
    },
    async transferUsdc(input) {
      const wallets = await loadWallets();
      if (typeof wallets.escrow.transfer !== "function") {
        throw new EscrowError(
          "rail_failed",
          "CDP escrow account has no transfer() — check @coinbase/cdp-sdk version.",
        );
      }
      try {
        const sent = await wallets.escrow.transfer({
          to: input.to,
          amount: input.amountAtomic,
          token: "usdc",
          network: probe.unsafeNetwork ? "base" : "base-sepolia",
          idempotencyKey: input.idempotencyKey,
        });
        const txHash = sent.transactionHash?.trim();
        if (!txHash) {
          throw new EscrowError(
            "rail_failed",
            `CDP ${input.purpose} transfer returned no transaction hash. Do not assume the wallet moved. Recon before retrying.`,
          );
        }
        return { txHash };
      } catch (err) {
        if (err instanceof EscrowError) throw err;
        throw new EscrowError(
          "rail_failed",
          err instanceof Error ? err.message : `CDP ${input.purpose} transfer failed`,
        );
      }
    },
  };
}

/**
 * Pick the rail. Mainnet is refused unless explicitly allowed.
 * Missing CDP_* → mock rail that documents the exact missing names (no silent lock).
 */
export function resolveRail(env: EnvMap = process.env): CdpRail {
  const probe = probeCdpEnv(env);
  if (probe.unsafeNetwork && !probe.mainnetAllowed) {
    throw new EscrowError(
      "mainnet_refused",
      `CDP_NETWORK=${probe.network} looks like mainnet. Refusing real USDC prod spend. Default is base-sepolia. Set CDP_ALLOW_MAINNET=1 only with an explicit prod go-live.`,
      { details: { network: probe.network } },
    );
  }
  if (probe.mode === "cdp") {
    return createCdpRail(env, probe);
  }
  return createMockRail(probe);
}
