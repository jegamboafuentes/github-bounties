import { http, createConfig, type Config, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { baseSepolia } from "wagmi/chains";
import { PRODUCT_NAME } from "../lib/constants";

/** DEV / sandbox fund chain. Mainnet is refused in the pay path. */
export const FUND_CHAIN = baseSepolia;

export function createFundWagmiConfig(projectId: string): Config {
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
        showQrModal: true,
        metadata: {
          name: PRODUCT_NAME,
          description: "Fund GitHub issue bounties with exact-face USDC on Base Sepolia.",
          url: "https://dev.githubbounties.xyz",
          icons: ["https://dev.githubbounties.xyz/icon.png"],
        },
      }) as CreateConnectorFn,
    );
  }
  return createConfig({
    chains: [FUND_CHAIN],
    connectors,
    transports: {
      [FUND_CHAIN.id]: http(),
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
