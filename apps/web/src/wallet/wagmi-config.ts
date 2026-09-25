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
  const shared = {
    connectors,
    ssr: false as const,
    multiInjectedProviderDiscovery: true,
  };
  if (fund.chainId === 8453) {
    return createConfig({
      ...shared,
      chains: [base],
      transports: { [base.id]: http() },
    });
  }
  return createConfig({
    ...shared,
    chains: [baseSepolia],
    transports: { [baseSepolia.id]: http() },
  });
}
