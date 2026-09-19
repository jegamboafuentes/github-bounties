"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { createFundWagmiConfig } from "./config";
import type { FundWalletRuntime } from "./env";

const FundWalletContext = createContext<FundWalletRuntime | null>(null);

export function useFundWallet(): FundWalletRuntime {
  const value = useContext(FundWalletContext);
  if (!value) {
    throw new Error("useFundWallet must be used within WalletProviders");
  }
  return value;
}

export function WalletProviders({
  projectId,
  fund,
  children,
}: {
  projectId: string;
  fund: FundWalletRuntime;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [config] = useState(() =>
    createFundWagmiConfig(projectId, {
      chain: fund.chainId === 8453 ? base : baseSepolia,
      metadataUrl: fund.metadataUrl,
    }),
  );

  return (
    <FundWalletContext.Provider value={fund}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </FundWalletContext.Provider>
  );
}
