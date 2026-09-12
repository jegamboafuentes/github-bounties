import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/constants";
import { WalletProviders } from "@/wallet/providers";
import { readWalletConnectProjectId } from "@/wallet/env";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "USDC bounties on GitHub issues. 2% fee. Exclusive 72h claim-lock.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const walletConnectProjectId = readWalletConnectProjectId();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <WalletProviders projectId={walletConnectProjectId}>{children}</WalletProviders>
      </body>
    </html>
  );
}
