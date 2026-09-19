import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_MAINNET_CAIP2,
  BASE_SEPOLIA_CAIP2,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
} from "../lib/constants";
import {
  LOCAL_WALLET_ORIGIN,
  WALLETCONNECT_PROJECT_ID_ENV,
  isFundMainnetEnabled,
  readWalletConnectProjectId,
  resolveFundWalletRuntime,
  walletConnectConfigured,
  walletConnectMetadataOrigin,
  walletConnectStatus,
} from "./env";

describe("WalletConnect project id (public env)", () => {
  it("reads NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID without treating it as a secret", () => {
    assert.equal(WALLETCONNECT_PROJECT_ID_ENV, "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID");
    assert.equal(readWalletConnectProjectId({}), "");
    assert.equal(walletConnectConfigured({}), false);
    assert.equal(
      readWalletConnectProjectId({ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "  abc123  " }),
      "abc123",
    );
    assert.equal(
      walletConnectConfigured({ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "abc123" }),
      true,
    );
    const status = walletConnectStatus({
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "abc123",
      CDP_NETWORK: "base-sepolia",
    });
    assert.equal(status.configured, true);
    assert.equal(status.network, "base-sepolia");
    assert.equal(status.fundChain, BASE_SEPOLIA_CAIP2);
    assert.equal(status.hostedCheckout, "disabled");
    assert.equal(status.env, WALLETCONNECT_PROJECT_ID_ENV);
  });
});

describe("fund chain from CDP_NETWORK (same gate as the rail)", () => {
  it("defaults to Base Sepolia and localhost WC origin", () => {
    assert.equal(isFundMainnetEnabled({}), false);
    assert.equal(walletConnectMetadataOrigin({}), LOCAL_WALLET_ORIGIN);
    const fund = resolveFundWalletRuntime({});
    assert.equal(fund.chainId, 84532);
    assert.equal(fund.chainName, "Base Sepolia");
    assert.equal(fund.caip2, BASE_SEPOLIA_CAIP2);
    assert.equal(fund.usdc, USDC_BASE_SEPOLIA);
    assert.equal(fund.allowMainnet, false);
    assert.equal(fund.metadataUrl, LOCAL_WALLET_ORIGIN);
  });

  it("keeps Sepolia when CDP_NETWORK is mainnet but the allow flag is unset", () => {
    assert.equal(isFundMainnetEnabled({ CDP_NETWORK: "base" }), false);
    assert.equal(isFundMainnetEnabled({ CDP_NETWORK: "eip155:8453" }), false);
    const fund = resolveFundWalletRuntime({ CDP_NETWORK: "base-mainnet" });
    assert.equal(fund.chainId, 84532);
    assert.equal(fund.allowMainnet, false);
    assert.equal(fund.network, "base-mainnet");
  });

  it("enables Base mainnet USDC only when network + CDP_ALLOW_MAINNET are set", () => {
    for (const network of ["base", "base-mainnet", "eip155:8453"] as const) {
      assert.equal(
        isFundMainnetEnabled({ CDP_NETWORK: network, CDP_ALLOW_MAINNET: "1" }),
        true,
      );
    }
    assert.equal(isFundMainnetEnabled({ CDP_NETWORK: "base", CDP_ALLOW_MAINNET: "true" }), true);
    assert.equal(isFundMainnetEnabled({ CDP_NETWORK: "base", CDP_ALLOW_MAINNET: "yes" }), true);
    assert.equal(
      isFundMainnetEnabled({ CDP_NETWORK: "base-sepolia", CDP_ALLOW_MAINNET: "1" }),
      false,
    );
    const fund = resolveFundWalletRuntime({
      CDP_NETWORK: "base",
      CDP_ALLOW_MAINNET: "1",
      PUBLIC_BASE_URL: "https://githubbounties.xyz/",
    });
    assert.equal(fund.chainId, 8453);
    assert.equal(fund.chainName, "Base");
    assert.equal(fund.caip2, BASE_MAINNET_CAIP2);
    assert.equal(fund.usdc, USDC_BASE_MAINNET);
    assert.equal(fund.allowMainnet, true);
    assert.equal(fund.metadataUrl, "https://githubbounties.xyz");
  });

  it("prefers PUBLIC_BASE_URL then AUTH_URL for WC metadata origin", () => {
    assert.equal(
      walletConnectMetadataOrigin({ PUBLIC_BASE_URL: "https://githubbounties.xyz/" }),
      "https://githubbounties.xyz",
    );
    assert.equal(
      walletConnectMetadataOrigin({ AUTH_URL: "https://dev.githubbounties.xyz" }),
      "https://dev.githubbounties.xyz",
    );
    assert.equal(
      walletConnectMetadataOrigin({
        PUBLIC_BASE_URL: "https://githubbounties.xyz",
        AUTH_URL: "https://dev.githubbounties.xyz",
      }),
      "https://githubbounties.xyz",
    );
  });
});
