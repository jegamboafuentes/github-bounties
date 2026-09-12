import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_SEPOLIA_CAIP2, USDC_BASE_SEPOLIA } from "../lib/constants";
import { decodePaymentRequiredHeader } from "../escrow/x402";
import {
  buildEip3009Authorization,
  buildExactPaymentPayload,
  caip2ToChainId,
  eip3009TypedData,
  encodePaymentSignatureHeader,
  lockAfterInbound,
  payX402Exact,
  randomAuthorizationNonce,
  type WalletTypedDataSigner,
} from "./pay-x402";

const challenge = {
  x402Version: 2 as const,
  error: "Payment required",
  resource: {
    url: "https://dev.githubbounties.xyz/api/bounties/b1/x402",
    description: "fund",
    mimeType: "application/json" as const,
  },
  accepts: [
    {
      scheme: "exact" as const,
      network: BASE_SEPOLIA_CAIP2,
      asset: USDC_BASE_SEPOLIA,
      amount: "10000000",
      payTo: "0x00000000000000000000000000000000e5c400",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC" as const, version: "2" as const },
    },
  ],
};

describe("x402 browser pay payload", () => {
  it("maps CAIP-2 to Base Sepolia and builds EIP-3009 typed data", () => {
    assert.equal(caip2ToChainId(BASE_SEPOLIA_CAIP2), 84532);
    assert.equal(caip2ToChainId("base-sepolia"), 84532);
    const auth = buildEip3009Authorization({
      from: "0x1111111111111111111111111111111111111111",
      to: "0x00000000000000000000000000000000e5c400",
      amountAtomic: "10000000",
      nowSeconds: 1_778_000_000,
      maxTimeoutSeconds: 300,
      nonce: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    assert.equal(auth.validAfter, "1777999970");
    assert.equal(auth.validBefore, "1778000300");
    const typed = eip3009TypedData({ requirements: challenge.accepts[0], authorization: auth });
    assert.equal(typed.domain.chainId, 84532);
    assert.equal(typed.domain.name, "USDC");
    assert.equal(typed.domain.version, "2");
    assert.equal(typed.domain.verifyingContract, USDC_BASE_SEPOLIA);
    assert.equal(typed.primaryType, "TransferWithAuthorization");
    assert.equal(typed.message.value, 10_000_000n);
  });

  it("encodes PAYMENT-SIGNATURE as base64 JSON like PAYMENT-REQUIRED", () => {
    const auth = buildEip3009Authorization({
      from: "0x1111111111111111111111111111111111111111",
      to: "0x00000000000000000000000000000000e5c400",
      amountAtomic: "1",
      nowSeconds: 10,
      maxTimeoutSeconds: 60,
      nonce: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const payload = buildExactPaymentPayload({
      challenge,
      requirements: challenge.accepts[0],
      authorization: auth,
      signature: `0x${"ab".repeat(65)}`,
    });
    const encoded = encodePaymentSignatureHeader(payload);
    const decoded = decodePaymentRequiredHeader(encoded) as unknown as typeof payload;
    assert.equal(decoded.x402Version, 2);
    assert.equal(decoded.accepted.scheme, "exact");
    assert.equal(decoded.payload.authorization.value, "1");
    const nonce = randomAuthorizationNonce((out) => out.fill(7));
    assert.equal(nonce, `0x${"07".repeat(32)}`);
  });

  it("signs the 402 challenge and retries with PAYMENT-SIGNATURE", async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fetchImpl: typeof fetch = (async (url, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url: String(url), headers });
      if (!headers["payment-signature"]) {
        return new Response(JSON.stringify(challenge), { status: 402 });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          inboundRecorded: true,
          fundTxHash: "0xabc",
          message: "recorded",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const signer: WalletTypedDataSigner = {
      address: "0x1111111111111111111111111111111111111111",
      signTypedData: async () => `0x${"cd".repeat(65)}`,
    };
    const paid = await payX402Exact({
      resourceUrl: "https://dev.githubbounties.xyz/api/bounties/b1/x402",
      signer,
      fetchImpl,
      nowSeconds: 1_778_000_000,
      nonce: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    assert.equal(paid.ok, true);
    if (paid.ok) {
      assert.equal(paid.inboundRecorded, true);
      assert.equal(paid.fundTxHash, "0xabc");
    }
    assert.equal(calls.length, 2);
    assert.ok(calls[1]?.headers?.["payment-signature"]);
  });

  it("treats an already-recorded GET as success and locks with an empty hash body", async () => {
    const paid = await payX402Exact({
      resourceUrl: "/api/bounties/b1/x402",
      signer: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => {
          throw new Error("should not sign");
        },
      },
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: true, inboundRecorded: true, fundTxHash: "0xrec" }), {
          status: 200,
        })) as typeof fetch,
    });
    assert.equal(paid.ok, true);

    const locked = await lockAfterInbound(
      "b1",
      (async (url, init) => {
        assert.equal(String(url), "/api/bounties/b1/fund");
        assert.equal(init?.body, "{}");
        return new Response(JSON.stringify({ ok: true, fundTxHash: "0xrec" }), { status: 200 });
      }) as typeof fetch,
    );
    assert.equal(locked.ok, true);
    if (locked.ok) assert.equal(locked.alreadyFunded, true);
  });

  it("refuses Base mainnet in the browser pay path", async () => {
    const mainnet = {
      ...challenge,
      accepts: [{ ...challenge.accepts[0], network: "eip155:8453" as const }],
    };
    const result = await payX402Exact({
      resourceUrl: "/x402",
      signer: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => `0x${"ee".repeat(65)}`,
      },
      fetchImpl: (async () => new Response(JSON.stringify(mainnet), { status: 402 })) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "mainnet_refused");
  });
});
