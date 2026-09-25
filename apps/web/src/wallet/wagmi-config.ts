import { http, createConfig, type Config, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { base, baseSepolia } from "wagmi/chains";
import { walletConnectAppMetadata } from "./config";
import type { FundWalletRuntime } from "./env";

/**
 * Browser-only. Import this module from `getBrowserFundWagmiConfig` after the
 * window check so a server render never constructs WalletConnect Core.
 */
export function createBrowserFundWagmiConfig(projectId: string, fund: FundWalletRuntime): Config {
  if (typeof window === "undefined") {
    throw new Error("WalletConnect config is created in the browser only.");
  }
  const chain = fund.chainId === 8453 ? base : baseSepolia;
  const metadata = walletConnectAppMetadata(process.env, fund.metadataUrl);
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
    ssr: false,
    multiInjectedProviderDiscovery: true,
  });
}
