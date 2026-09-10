import { missingEnv, type EnvMap } from "../auth/env";

export type { EnvMap };
import {
  BASE_MAINNET_CAIP2,
  CDP_DEFAULT_NETWORK,
} from "../lib/constants";

/**
 * CDP / x402 env (V1-5). Secret Manager ids on experiment-jegf / 42206083192
 * match these names (already in repo-root `.env.example`). Never log values.
 */
export const CDP_REQUIRED_ENV_KEYS = [
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "CDP_WALLET_SECRET",
] as const;

export const CDP_OPTIONAL_ENV_KEYS = [
  "CDP_PROJECT_ID",
  "CDP_CLIENT_API_KEY",
  "CDP_WEBHOOK_SECRET",
] as const;

const MAINNET_NETWORKS = new Set([
  "base",
  "base-mainnet",
  BASE_MAINNET_CAIP2,
  "mainnet",
  "eip155:8453",
]);

export function missingCdpEnv(env: EnvMap = process.env): string[] {
  return missingEnv(CDP_REQUIRED_ENV_KEYS, env);
}

export function readCdpNetwork(env: EnvMap = process.env): string {
  return env.CDP_NETWORK?.trim() || CDP_DEFAULT_NETWORK;
}

export function isMainnetNetwork(network: string): boolean {
  return MAINNET_NETWORKS.has(network.trim().toLowerCase());
}

/** Explicit allow — both `CDP_NETWORK=base` (or equivalent) AND this flag. */
export function isMainnetAllowed(env: EnvMap = process.env): boolean {
  const flag = env.CDP_ALLOW_MAINNET?.trim();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function isDryRunLive(env: EnvMap = process.env): boolean {
  return env.CDP_DRY_RUN_LIVE === "1";
}

export type CdpRailMode = "cdp" | "mock";

export type CdpProbe = {
  network: string;
  missing: string[];
  optionalMissing: string[];
  liveRequested: boolean;
  unsafeNetwork: boolean;
  mainnetAllowed: boolean;
  mode: CdpRailMode;
  hostedCheckout: "disabled";
};

export function probeCdpEnv(env: EnvMap = process.env): CdpProbe {
  const network = readCdpNetwork(env);
  const missing = missingCdpEnv(env);
  const optionalMissing = missingEnv(CDP_OPTIONAL_ENV_KEYS, env);
  const liveRequested = isDryRunLive(env);
  const unsafeNetwork = isMainnetNetwork(network);
  const mainnetAllowed = isMainnetAllowed(env);
  const canLive =
    missing.length === 0 && (!unsafeNetwork || mainnetAllowed);
  return {
    network,
    missing,
    optionalMissing,
    liveRequested,
    unsafeNetwork,
    mainnetAllowed,
    mode: canLive ? "cdp" : "mock",
    hostedCheckout: "disabled",
  };
}

export function cdpMissingEnvMessage(missing: string[]): string {
  return [
    "CDP live rail is blocked. Missing Secret Manager / env:",
    ...missing.map((name) => `  - ${name}`),
    "Expected location: GCP project experiment-jegf (42206083192).",
    "Secret IDs match the env names (already in .env.example). Ops stashes values OOB.",
    "Never commit values. See docs/escrow.md.",
  ].join("\n");
}
