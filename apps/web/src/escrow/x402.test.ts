import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_MAINNET_CAIP2,
  BASE_SEPOLIA_CAIP2,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
  USDC_EIP712_NAME_MAINNET,
  USDC_EIP712_NAME_SEPOLIA,
} from "../lib/constants";
import { EscrowError } from "./errors";
import { x402SellerNetworkCaip2 } from "./x402-seller";
import { inboundIsRecorded, resolveLockFundTxHash } from "./inbound";
import { HOSTED_CHECKOUT_ENABLED } from "./hosted";
import {
  buildX402ExactChallenge,
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  extractPaymentHeader,
  publicOrigin,
  x402ChallengeResponseBody,
  x402DollarPrice,
  x402ExactStatus,
  x402FailureFromChallenge,
  x402NetworkCaip2,
  x402ResourceUrl,
  x402UsdcEip712Extra,
} from "./x402";

describe("x402 exact fund challenge", () => {
  it("builds a v2 exact challenge to gb-escrow with face atomic amount", () => {
    const challenge = buildX402ExactChallenge({
      bountyId: "11111111-1111-4111-8111-111111111111",
      origin: "https://dev.githubbounties.xyz",
      payTo: "0x00000000000000000000000000000000e5c400",
      faceUsdc: "12.500000",
      network: "base-sepolia",
    });
    assert.equal(challenge.x402Version, 2);
    assert.equal(challenge.accepts.length, 1);
    const accept = challenge.accepts[0];
    assert.equal(accept.scheme, "exact");
    assert.equal(accept.network, BASE_SEPOLIA_CAIP2);
    assert.equal(accept.asset, USDC_BASE_SEPOLIA);
    assert.equal(accept.amount, "12500000");
    assert.equal(accept.payTo, "0x00000000000000000000000000000000e5c400");
    assert.equal(accept.extra.name, USDC_EIP712_NAME_SEPOLIA);
    assert.equal(accept.extra.version, "2");
    assert.equal(
      challenge.resource.url,
      "https://dev.githubbounties.xyz/api/bounties/11111111-1111-4111-8111-111111111111/x402",
    );
    const encoded = encodePaymentRequiredHeader(challenge);
    const decoded = decodePaymentRequiredHeader(encoded);
    assert.deepEqual(decoded.accepts, challenge.accepts);

    const clobberedExtras = x402ChallengeResponseBody(challenge, {
      payTo: challenge.accepts[0].payTo,
      resource: challenge.resource.url,
      rail: "cdp",
    });
    assert.equal(typeof clobberedExtras.resource, "object");
    assert.equal((clobberedExtras.resource as { url: string }).url, challenge.resource.url);
    assert.equal(clobberedExtras.resourceUrl, challenge.resource.url);
    assert.deepEqual(clobberedExtras.accepts, challenge.accepts);
  });

  it("prefers PUBLIC_BASE_URL / AUTH_URL and formats dollar prices", () => {
    assert.equal(publicOrigin({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/" }), "https://dev.githubbounties.xyz");
    assert.equal(publicOrigin({ AUTH_URL: "https://dev.githubbounties.xyz" }), "https://dev.githubbounties.xyz");
    assert.equal(
      x402ResourceUrl("b", "https://dev.githubbounties.xyz"),
      "https://dev.githubbounties.xyz/api/bounties/b/x402",
    );
    assert.equal(x402DollarPrice("12.000000"), "$12.00");
    assert.equal(x402DollarPrice("0.010000"), "$0.01");
    assert.equal(x402NetworkCaip2("base-sepolia"), BASE_SEPOLIA_CAIP2);
    assert.equal(x402ExactStatus({}).hostedCheckout, "disabled");
    assert.equal(HOSTED_CHECKOUT_ENABLED, false);
  });

  it("uses USD Coin EIP-712 extra on Base mainnet (not Sepolia USDC)", () => {
    const challenge = buildX402ExactChallenge({
      bountyId: "22222222-2222-4222-8222-222222222222",
      origin: "https://githubbounties.xyz",
      payTo: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
      faceUsdc: "1",
      network: "base",
    });
    const accept = challenge.accepts[0];
    assert.equal(accept.network, BASE_MAINNET_CAIP2);
    assert.equal(accept.asset, USDC_BASE_MAINNET);
    assert.equal(accept.amount, "1000000");
    assert.equal(accept.extra.name, USDC_EIP712_NAME_MAINNET);
    assert.equal(x402UsdcEip712Extra("base-sepolia").name, USDC_EIP712_NAME_SEPOLIA);
    assert.equal(x402UsdcEip712Extra("eip155:8453").name, USDC_EIP712_NAME_MAINNET);
  });

  it("reads verify failure from PAYMENT-REQUIRED when the JSON body is empty", () => {
    const header = encodePaymentRequiredHeader({
      x402Version: 2,
      error: "invalid_signature",
      resource: {
        url: "https://githubbounties.xyz/api/bounties/b1/x402",
        description: "",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: BASE_MAINNET_CAIP2,
          asset: USDC_BASE_MAINNET,
          amount: "1000000",
          payTo: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
          maxTimeoutSeconds: 300,
          extra: { name: USDC_EIP712_NAME_MAINNET, version: "2" },
        },
      ],
    });
    const decoded = x402FailureFromChallenge({ body: {}, headers: { "PAYMENT-REQUIRED": header } });
    assert.equal(decoded.errorReason, "invalid_signature");
    assert.equal(
      x402FailureFromChallenge({ body: { error: "payment_required" } }).errorReason,
      "x402_verify_failed",
    );
  });

  it("seller follows the rail mainnet allow flag", () => {
    assert.equal(x402SellerNetworkCaip2("base-sepolia", {}), BASE_SEPOLIA_CAIP2);
    assert.throws(
      () => x402SellerNetworkCaip2("base", {}),
      (err: unknown) => err instanceof EscrowError && err.code === "mainnet_refused",
    );
    assert.equal(
      x402SellerNetworkCaip2("eip155:8453", { CDP_ALLOW_MAINNET: "1" }),
      BASE_MAINNET_CAIP2,
    );
  });

  it("reads PAYMENT-SIGNATURE / X-PAYMENT and prefers pasted hash over recorded inbound", () => {
    assert.equal(
      extractPaymentHeader((name) => (name === "PAYMENT-SIGNATURE" ? "sig" : null)),
      "sig",
    );
    assert.equal(extractPaymentHeader((name) => (name === "X-PAYMENT" ? "legacy" : null)), "legacy");
    assert.equal(extractPaymentHeader(() => null), undefined);
    assert.equal(resolveLockFundTxHash({ pasted: " 0xabc ", recorded: "0xold" }), "0xabc");
    assert.equal(resolveLockFundTxHash({ pasted: "", recorded: "0xrec" }), "0xrec");
    assert.equal(resolveLockFundTxHash({}), undefined);
    assert.equal(inboundIsRecorded({ status: "pending", fundTxHash: "0xabc" }), true);
    assert.equal(inboundIsRecorded({ status: "pending", x402PaymentId: "x402:1" }), true);
    assert.equal(inboundIsRecorded({ status: "funded", fundTxHash: "0xabc" }), true);
    assert.equal(inboundIsRecorded({ status: "settled", x402PaymentId: "x402:1" }), true);
    assert.equal(inboundIsRecorded({ status: "pending" }), false);
  });
});
