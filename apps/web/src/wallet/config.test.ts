import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base, baseSepolia } from "wagmi/chains";
import { PRODUCT_NAME } from "../lib/constants";
import {
  FUND_CHAIN,
  isWalletConnectConnector,
  resolveFundChain,
  shortenAddress,
  walletConnectAppMetadata,
} from "./config";

describe("wallet connect helpers", () => {
  it("shortens addresses and detects WalletConnect connectors", () => {
    assert.equal(shortenAddress("0x1111111111111111111111111111111111111111"), "0x1111…1111");
    assert.equal(shortenAddress("0xabc"), "0xabc");
    assert.equal(
      isWalletConnectConnector({ id: "walletConnect", name: "WalletConnect", type: "walletConnect" }),
      true,
    );
    assert.equal(isWalletConnectConnector({ id: "injected", name: "Injected", type: "injected" }), false);
  });

  it("resolves wagmi Base only when the rail allow flag is set", () => {
    assert.equal(resolveFundChain({}).id, baseSepolia.id);
    assert.equal(resolveFundChain({ CDP_NETWORK: "base" }).id, baseSepolia.id);
    assert.equal(resolveFundChain({ CDP_NETWORK: "base", CDP_ALLOW_MAINNET: "1" }).id, base.id);
    assert.equal(FUND_CHAIN.id, baseSepolia.id);
  });

  it("builds WC metadata from PUBLIC_BASE_URL / AUTH_URL (localhost fallback)", () => {
    const local = walletConnectAppMetadata({});
    assert.equal(local.name, PRODUCT_NAME);
    assert.equal(local.url, "http://localhost:3000");
    assert.equal(local.icons[0], "http://localhost:3000/icon.png");
    assert.match(local.description, /Base Sepolia/);

    const prod = walletConnectAppMetadata(
      { CDP_NETWORK: "base", CDP_ALLOW_MAINNET: "1", AUTH_URL: "https://ignored.example" },
      "https://githubbounties.xyz",
    );
    assert.equal(prod.url, "https://githubbounties.xyz");
    assert.equal(prod.icons[0], "https://githubbounties.xyz/icon.png");
    assert.match(prod.description, /\bBase\b/);
    assert.doesNotMatch(prod.description, /Sepolia/);
  });
});
