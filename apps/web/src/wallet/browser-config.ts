import type { Config } from "wagmi";
import type { FundWalletRuntime } from "./env";

const GLOBAL_KEY = "__githubBountiesFundWagmi";

type Slot = { key: string; config: Config };

function store(): { current?: Slot } {
  const root = globalThis as typeof globalThis & { [GLOBAL_KEY]?: { current?: Slot } };
  if (!root[GLOBAL_KEY]) root[GLOBAL_KEY] = {};
  return root[GLOBAL_KEY];
}

/**
 * One wagmi config per browser session, including across HMR.
 * WalletConnect Core is constructed only here, and only when `window` exists.
 */
export async function getBrowserFundWagmiConfig(
  projectId: string,
  fund: FundWalletRuntime,
): Promise<Config> {
  if (typeof window === "undefined") {
    throw new Error("WalletConnect config is created in the browser only.");
  }
  const key = `${projectId}\n${fund.chainId}\n${fund.metadataUrl}`;
  const slot = store();
  if (slot.current?.key === key) return slot.current.config;
  const { createBrowserFundWagmiConfig } = await import("./wagmi-config");
  const config = createBrowserFundWagmiConfig(projectId, fund);
  slot.current = { key, config };
  return config;
}
