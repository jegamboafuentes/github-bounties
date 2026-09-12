"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { createFundWagmiConfig } from "./config";

export function WalletProviders({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [config] = useState(() => createFundWagmiConfig(projectId));

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
