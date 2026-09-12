import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWalletConnectConnector, shortenAddress } from "./config";

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
});
