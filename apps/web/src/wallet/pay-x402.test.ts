import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_MAINNET_CAIP2, BASE_SEPOLIA_CAIP2, USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { decodePaymentRequiredHeader } from "../escrow/x402";
import { encodePaymentRequiredHeader } from "../escrow/x402";
import {
  buildEip3009Authorization,
  buildExactPaymentPayload,
  caip2ToChainId,
  eip3009TypedData,
  encodePaymentSignatureHeader,
  defaultFundChainCaip2,
  facilitatorRechallengeFromSettle,
  lockAfterInbound,
  parseX402Challenge,
  payX402Exact,
  randomAuthorizationNonce,
  sameOriginX402Path,
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

  it("parses the DEV 402 body when extras overwrite resource with a URL string", async () => {
    const clobbered = {
      ...challenge,
      ok: false,
      error: "payment_required",
      resource: challenge.resource.url,
      payTo: challenge.accepts[0].payTo,
      rail: "cdp",
    };
    const parsed = parseX402Challenge(clobbered, null, "/api/bounties/b1/x402");
    assert.ok(parsed);
    assert.equal(parsed?.accepts[0]?.scheme, "exact");
    assert.equal(parsed?.accepts[0]?.amount, "10000000");
    assert.equal(parsed?.resource.url, challenge.resource.url);
    assert.equal(sameOriginX402Path(challenge.resource.url), "/api/bounties/b1/x402");

    const signer: WalletTypedDataSigner = {
      address: "0x1111111111111111111111111111111111111111",
      signTypedData: async () => `0x${"cd".repeat(65)}`,
    };
    const paid = await payX402Exact({
      resourceUrl: "https://dev.githubbounties.xyz/api/bounties/b1/x402",
      signer,
      nowSeconds: 1_778_000_000,
      nonce: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      fetchImpl: (async (url, init) => {
        assert.equal(String(url), "/api/bounties/b1/x402");
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        if (!headers["payment-signature"]) {
          return new Response(JSON.stringify(clobbered), {
            status: 402,
            headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge) },
          });
        }
        return new Response(
          JSON.stringify({ ok: true, inboundRecorded: true, fundTxHash: "0xabc" }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(paid.ok, true);
    if (paid.ok) assert.equal(paid.inboundRecorded, true);
    assert.equal(parseX402Challenge({ error: "payment_required", resource: "/x402" }, null), null);
  });

  it("refuses Base mainnet in the browser pay path when the allow flag is unset", async () => {
    const mainnet = {
      ...challenge,
      accepts: [{ ...challenge.accepts[0], network: BASE_MAINNET_CAIP2, asset: USDC_BASE_MAINNET }],
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
    assert.equal(defaultFundChainCaip2({}), BASE_SEPOLIA_CAIP2);
    assert.equal(defaultFundChainCaip2({ CDP_NETWORK: "base" }), BASE_SEPOLIA_CAIP2);
  });

  it("pays Base mainnet when allowMainnet is set (PROD rail)", async () => {
    const mainnet = {
      ...challenge,
      accepts: [{ ...challenge.accepts[0], network: BASE_MAINNET_CAIP2, asset: USDC_BASE_MAINNET }],
    };
    let signedChainId: number | undefined;
    const result = await payX402Exact({
      resourceUrl: "/x402",
      allowMainnet: true,
      signer: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async (typed) => {
          signedChainId = typed.domain.chainId;
          return `0x${"ee".repeat(65)}`;
        },
      },
      fetchImpl: (async (_url, init) => {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        if (!headers["payment-signature"]) {
          return new Response(JSON.stringify(mainnet), { status: 402 });
        }
        return new Response(
          JSON.stringify({ ok: true, inboundRecorded: true, fundTxHash: "0xmain" }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(result.ok, true);
    assert.equal(signedChainId, 8453);
    assert.equal(
      defaultFundChainCaip2({ CDP_NETWORK: "base", CDP_ALLOW_MAINNET: "1" }),
      BASE_MAINNET_CAIP2,
    );
  });

  it("signs Base mainnet USDC with EIP-712 name USD Coin", () => {
    const auth = buildEip3009Authorization({
      from: "0x1111111111111111111111111111111111111111",
      to: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
      amountAtomic: "1000000",
      nowSeconds: 1_778_000_000,
      maxTimeoutSeconds: 300,
      nonce: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const typed = eip3009TypedData({
      requirements: {
        ...challenge.accepts[0],
        network: BASE_MAINNET_CAIP2,
        asset: USDC_BASE_MAINNET,
        extra: { name: "USD Coin", version: "2" },
      },
      authorization: auth,
    });
    assert.equal(typed.domain.chainId, 8453);
    assert.equal(typed.domain.name, "USD Coin");
    assert.equal(typed.domain.verifyingContract, USDC_BASE_MAINNET);
  });

  it("does not map a settle-path 402 re-challenge to x402_settle_failed", async () => {
    const result = await payX402Exact({
      resourceUrl: "/x402",
      allowMainnet: true,
      signer: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: async () => `0x${"ee".repeat(65)}`,
      },
      fetchImpl: (async (_url, init) => {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        if (!headers["payment-signature"]) {
          return new Response(
            JSON.stringify({
              ...challenge,
              accepts: [
                {
                  ...challenge.accepts[0],
                  network: BASE_MAINNET_CAIP2,
                  asset: USDC_BASE_MAINNET,
                  extra: { name: "USD Coin", version: "2" },
                },
              ],
            }),
            { status: 402 },
          );
        }
        return new Response(JSON.stringify({}), { status: 402 });
      }) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "facilitator_rechallenge");
      assert.match(result.message, /re-challenged/i);
      assert.notEqual(result.error, "x402_settle_failed");
    }

    const fromChallengeBody = facilitatorRechallengeFromSettle({
      status: 402,
      body: { error: "payment_required", accepts: challenge.accepts, resource: challenge.resource },
      paymentRequiredHeader: encodePaymentRequiredHeader({
        ...challenge,
        error: "invalid_signature",
      }),
    });
    assert.equal(fromChallengeBody?.ok, false);
    if (fromChallengeBody && !fromChallengeBody.ok) {
      assert.equal(fromChallengeBody.error, "facilitator_rechallenge");
      assert.match(fromChallengeBody.message, /invalid_signature/);
    }
    assert.equal(facilitatorRechallengeFromSettle({ status: 200, body: { ok: true } }), null);
  });
});
