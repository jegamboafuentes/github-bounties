import type { Metadata } from "next";
import { headers } from "next/headers";
import { mappedHostHeader } from "@/lib/site-env";
import { buildSocialMetadata } from "@/lib/social-metadata";
import { WalletProviders } from "@/wallet/providers";
import { readWalletConnectProjectId, resolveFundWalletRuntime } from "@/wallet/env";
import "./globals.css";

/** Pages already opt into dynamic rendering; metadata must follow runtime env. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  return buildSocialMetadata(process.env, {
    host: mappedHostHeader(requestHeaders),
    proto: requestHeaders.get("x-forwarded-proto"),
  });
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const walletConnectProjectId = readWalletConnectProjectId();
  const fund = resolveFundWalletRuntime();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <WalletProviders projectId={walletConnectProjectId} fund={fund}>
          {children}
        </WalletProviders>
      </body>
    </html>
  );
}
