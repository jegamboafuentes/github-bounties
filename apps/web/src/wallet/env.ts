import type { EnvMap } from "../auth/env";
import { CDP_DEFAULT_NETWORK } from "../lib/constants";

/**
 * Reown / WalletConnect Cloud project id (public). Not a secret — it is
 * bundled into the browser connector. Ops sets
 * `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` on Cloud Run (plain env) and locally.
 * Never put CDP_* or other secrets here.
 */
export const WALLETCONNECT_PROJECT_ID_ENV = "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID";

export function readWalletConnectProjectId(env: EnvMap = process.env): string {
  return env[WALLETCONNECT_PROJECT_ID_ENV]?.trim() || "";
}

export function walletConnectConfigured(env: EnvMap = process.env): boolean {
  return readWalletConnectProjectId(env).length > 0;
}

export function walletConnectStatus(env: EnvMap = process.env) {
  return {
    configured: walletConnectConfigured(env),
    env: WALLETCONNECT_PROJECT_ID_ENV,
    network: env.CDP_NETWORK?.trim() || CDP_DEFAULT_NETWORK,
    hostedCheckout: "disabled" as const,
  };
}
