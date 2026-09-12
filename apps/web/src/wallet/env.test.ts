import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WALLETCONNECT_PROJECT_ID_ENV,
  readWalletConnectProjectId,
  walletConnectConfigured,
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
    assert.equal(status.hostedCheckout, "disabled");
    assert.equal(status.env, WALLETCONNECT_PROJECT_ID_ENV);
  });
});
