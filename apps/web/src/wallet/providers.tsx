"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { WagmiProvider, type Config } from "wagmi";
import { getBrowserFundWagmiConfig } from "./browser-config";
import type { FundWalletRuntime } from "./env";

const FundWalletContext = createContext<FundWalletRuntime | null>(null);
const WagmiReadyContext = createContext(false);

export function useFundWallet(): FundWalletRuntime {
  const value = useContext(FundWalletContext);
  if (!value) {
    throw new Error("useFundWallet must be used within WalletProviders");
  }
  return value;
}

/** True only after the browser singleton config is mounted inside WagmiProvider. */
export function useWagmiReady(): boolean {
  return useContext(WagmiReadyContext);
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
  const [config, setConfig] = useState<Config | null>(null);
  const { chainId, metadataUrl } = fund;

  useEffect(() => {
    let cancelled = false;
    void getBrowserFundWagmiConfig(projectId, fund).then((next) => {
      if (!cancelled) setConfig(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, fund, chainId, metadataUrl]);

  const tree = (
    <FundWalletContext.Provider value={fund}>
      <WagmiReadyContext.Provider value={config !== null}>{children}</WagmiReadyContext.Provider>
    </FundWalletContext.Provider>
  );

  if (!config) return tree;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    </WagmiProvider>
  );
}
