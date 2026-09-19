import type { EnvMap } from "../auth/env";
import { isMainnetAllowed, isMainnetNetwork, readCdpNetwork } from "../escrow/env";
import {
  BASE_MAINNET_CAIP2,
  BASE_SEPOLIA_CAIP2,
  CDP_DEFAULT_NETWORK,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
} from "../lib/constants";

/**
 * Reown / WalletConnect Cloud project id (public). Not a secret — it is
 * bundled into the browser connector. Ops sets
 * `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` on Cloud Run (plain env) and locally.
 * Never put CDP_* or other secrets here.
 */
export const WALLETCONNECT_PROJECT_ID_ENV = "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID";

export const LOCAL_WALLET_ORIGIN = "http://localhost:3000";

export function readWalletConnectProjectId(env: EnvMap = process.env): string {
  return env[WALLETCONNECT_PROJECT_ID_ENV]?.trim() || "";
}

export function walletConnectConfigured(env: EnvMap = process.env): boolean {
  return readWalletConnectProjectId(env).length > 0;
}

/**
 * WC metadata `url` / icon origin. Same preference as the x402 resource
 * origin (`PUBLIC_BASE_URL` then `AUTH_URL`), then localhost for local dev.
 */
export function walletConnectMetadataOrigin(env: EnvMap = process.env): string {
  const configured = env.PUBLIC_BASE_URL?.trim() || env.AUTH_URL?.trim() || "";
  return (configured || LOCAL_WALLET_ORIGIN).replace(/\/$/, "");
}

/**
 * Client fund chain follows the rail: Base mainnet only when `CDP_NETWORK`
 * is a mainnet alias **and** `CDP_ALLOW_MAINNET` is truthy. Otherwise DEV
 * default Base Sepolia. Hosted checkout stays disabled.
 */
export function isFundMainnetEnabled(env: EnvMap = process.env): boolean {
  return isMainnetNetwork(readCdpNetwork(env)) && isMainnetAllowed(env);
}

export type FundWalletRuntime = {
  chainId: 8453 | 84532;
  chainName: "Base" | "Base Sepolia";
  caip2: typeof BASE_MAINNET_CAIP2 | typeof BASE_SEPOLIA_CAIP2;
  usdc: typeof USDC_BASE_MAINNET | typeof USDC_BASE_SEPOLIA;
  allowMainnet: boolean;
  metadataUrl: string;
  network: string;
};

export function resolveFundWalletRuntime(env: EnvMap = process.env): FundWalletRuntime {
  const network = readCdpNetwork(env);
  const metadataUrl = walletConnectMetadataOrigin(env);
  if (isFundMainnetEnabled(env)) {
    return {
      chainId: 8453,
      chainName: "Base",
      caip2: BASE_MAINNET_CAIP2,
      usdc: USDC_BASE_MAINNET,
      allowMainnet: true,
      metadataUrl,
      network,
    };
  }
  return {
    chainId: 84532,
    chainName: "Base Sepolia",
    caip2: BASE_SEPOLIA_CAIP2,
    usdc: USDC_BASE_SEPOLIA,
    allowMainnet: false,
    metadataUrl,
    network,
  };
}

export function walletConnectStatus(env: EnvMap = process.env) {
  const fund = resolveFundWalletRuntime(env);
  return {
    configured: walletConnectConfigured(env),
    env: WALLETCONNECT_PROJECT_ID_ENV,
    network: env.CDP_NETWORK?.trim() || CDP_DEFAULT_NETWORK,
    fundChain: fund.caip2,
    hostedCheckout: "disabled" as const,
  };
}
