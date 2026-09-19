import { http, createConfig, type Config, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { base, baseSepolia, type Chain } from "wagmi/chains";
import type { EnvMap } from "../auth/env";
import { PRODUCT_NAME } from "../lib/constants";
import { isFundMainnetEnabled, walletConnectMetadataOrigin } from "./env";

/** wagmi chain for the fund / WalletConnect path. Same gate as the CDP rail. */
export function resolveFundChain(env: EnvMap = process.env): typeof base | typeof baseSepolia {
  return isFundMainnetEnabled(env) ? base : baseSepolia;
}

/**
 * Module default from process.env (DEV = Base Sepolia). Browser connectors
 * must use the runtime passed into `createFundWagmiConfig` / WalletProviders —
 * `CDP_*` is not a NEXT_PUBLIC_ build-time value.
 */
export const FUND_CHAIN = resolveFundChain();

export function walletConnectAppMetadata(env: EnvMap = process.env, origin?: string) {
  const url = (origin ?? walletConnectMetadataOrigin(env)).replace(/\/$/, "");
  const chain = resolveFundChain(env);
  return {
    name: PRODUCT_NAME,
    description: `Fund GitHub issue bounties with exact-face USDC on ${chain.name}.`,
    url,
    icons: [`${url}/icon.png`],
  };
}

export function createFundWagmiConfig(
  projectId: string,
  options: { chain?: Chain; metadataUrl?: string; env?: EnvMap } = {},
): Config {
  const chain = options.chain ?? resolveFundChain(options.env);
  const metadata = walletConnectAppMetadata(options.env, options.metadataUrl);
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
        showQrModal: true,
        metadata,
      }) as CreateConnectorFn,
    );
  }
  return createConfig({
    chains: [chain],
    connectors,
    transports: {
      [chain.id]: http(),
    },
    ssr: true,
    multiInjectedProviderDiscovery: true,
  });
}

export function shortenAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isWalletConnectConnector(connector: { id: string; name: string; type: string }): boolean {
  return (
    connector.id === "walletConnect" ||
    connector.type === "walletConnect" ||
    /walletconnect/i.test(connector.name)
  );
}
