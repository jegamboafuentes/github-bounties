import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Attribution } from "ox/erc8021";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import {
  BUILDER_CODE_PATTERN,
  BuilderCodeError,
  ERC8021_SUFFIX_MARKER,
  builderCodeDataSuffix,
  encodeUsdcTransferData,
  readBuilderCode,
  sendUsdcTransfer,
} from "./builder-code";
import { EscrowError } from "./errors";
import { transferUsdcFromAccount } from "./rail";

const TO = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const AMOUNT = 1_250_000n;
const CODE = "bc_b7k3p9da";
const SUFFIX = "0x62635f62376b33703964610b0080218021802180218021802180218021";

function plainTransfer() {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [TO, AMOUNT],
  });
}

describe("builder code suffix", () => {
  it("accepts the public pattern and treats blank as unset", () => {
    assert.equal(BUILDER_CODE_PATTERN.test(CODE), true);
    assert.equal(readBuilderCode({}), null);
    assert.equal(readBuilderCode({ BASE_BUILDER_CODE: "" }), null);
    assert.equal(readBuilderCode({ BASE_BUILDER_CODE: "   " }), null);
    assert.equal(readBuilderCode({ BASE_BUILDER_CODE: `  ${CODE}  ` }), CODE);
    assert.equal(builderCodeDataSuffix({}), "0x");
    assert.throws(
      () => readBuilderCode({ BASE_BUILDER_CODE: "Bad-Code" }),
      (err: unknown) => err instanceof BuilderCodeError,
    );
    assert.throws(() => readBuilderCode({ BASE_BUILDER_CODE: "a".repeat(33) }), BuilderCodeError);
  });

  it("ends in the ERC-8021 marker and decodes back to the code", () => {
    const suffix = builderCodeDataSuffix({ BASE_BUILDER_CODE: CODE });
    assert.equal(suffix, SUFFIX);
    assert.ok(suffix.endsWith(ERC8021_SUFFIX_MARKER));
    assert.equal(ERC8021_SUFFIX_MARKER.length, 32);
    assert.deepEqual(Attribution.fromData(suffix), { codes: [CODE], id: 0 });
  });

  it("builds plain transfer calldata when the code is unset", () => {
    const data = encodeUsdcTransferData(TO, AMOUNT, {});
    const plain = plainTransfer();
    assert.equal(data, plain);
    assert.equal((data.length - 2) / 2, 68);
    assert.equal(Attribution.fromData(data), undefined);
  });

  it("appends the suffix only when the code is set", () => {
    const plain = plainTransfer();
    const data = encodeUsdcTransferData(TO, AMOUNT, { BASE_BUILDER_CODE: CODE });
    assert.equal(data.startsWith(plain), true);
    assert.notEqual(data, plain);
    assert.ok(data.endsWith(ERC8021_SUFFIX_MARKER));
    assert.deepEqual(Attribution.fromData(data), { codes: [CODE], id: 0 });
  });
});

describe("USDC sendTransaction", () => {
  it("forwards the idempotency key and omits the suffix when unset", async () => {
    const seen: { idempotencyKey: string; to: string; data: string; network: string }[] = [];
    const result = await transferUsdcFromAccount(
      {
        address: "0x4a26235bf51c73048635d607EB5371E9b3e611B8",
        async sendTransaction(args) {
          seen.push({
            idempotencyKey: args.idempotencyKey,
            to: args.transaction.to,
            data: args.transaction.data,
            network: args.network,
          });
          return { transactionHash: "0xabc" };
        },
      },
      {
        to: TO,
        amountAtomic: AMOUNT,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purpose: "hunter",
        kind: "HUNTER_PAYOUT",
      },
      { network: "base-sepolia", unsafeNetwork: false, env: {} },
    );
    assert.equal(result.txHash, "0xabc");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.idempotencyKey, "11111111-1111-4111-8111-111111111111");
    assert.equal(seen[0]?.network, "base-sepolia");
    assert.equal(seen[0]?.to, USDC_BASE_SEPOLIA);
    assert.equal(seen[0]?.data, plainTransfer());
  });

  it("uses Base mainnet USDC and appends the code when configured", async () => {
    let data = "0x";
    let token = "";
    let network = "";
    const sent = await sendUsdcTransfer(
      async (args) => {
        data = args.transaction.data;
        token = args.transaction.to;
        network = args.network;
        assert.equal(args.idempotencyKey, "fee-key");
        return { transactionHash: "0xdef" };
      },
      {
        to: TO,
        amountAtomic: AMOUNT,
        token: USDC_BASE_MAINNET as `0x${string}`,
        network: "base",
        idempotencyKey: "fee-key",
        env: { BASE_BUILDER_CODE: CODE },
      },
    );
    assert.equal(sent.transactionHash, "0xdef");
    assert.equal(token, USDC_BASE_MAINNET);
    assert.equal(network, "base");
    assert.ok(data.endsWith(ERC8021_SUFFIX_MARKER));
    assert.deepEqual(Attribution.fromData(data as `0x${string}`), { codes: [CODE], id: 0 });

    const mainnet = await transferUsdcFromAccount(
      {
        address: "0x1",
        async sendTransaction(args) {
          assert.equal(args.transaction.to, USDC_BASE_MAINNET);
          assert.equal(args.network, "base");
          assert.equal(args.idempotencyKey, "mainnet-key");
          return { transactionHash: "0xmain" };
        },
      },
      {
        to: TO,
        amountAtomic: AMOUNT,
        idempotencyKey: "mainnet-key",
        purpose: "fee",
        kind: "FEE_OUT",
      },
      { network: "base", unsafeNetwork: true, env: {} },
    );
    assert.equal(mainnet.txHash, "0xmain");
  });

  it("does not send when the code is invalid or the account cannot send", async () => {
    let calls = 0;
    const account = {
      address: "0x1",
      async sendTransaction() {
        calls += 1;
        return { transactionHash: "0x1" };
      },
    };
    await assert.rejects(
      () =>
        transferUsdcFromAccount(
          account,
          {
            to: TO,
            amountAtomic: AMOUNT,
            idempotencyKey: "k",
            purpose: "refund",
            kind: "REFUND_OUT",
          },
          { network: "base-sepolia", unsafeNetwork: false, env: { BASE_BUILDER_CODE: "NOPE" } },
        ),
      (err: unknown) => err instanceof EscrowError && err.code === "rail_failed",
    );
    assert.equal(calls, 0);
    await assert.rejects(
      () =>
        transferUsdcFromAccount(
          { address: "0x1" },
          {
            to: TO,
            amountAtomic: AMOUNT,
            idempotencyKey: "k",
            purpose: "refund",
            kind: "REFUND_OUT",
          },
          { network: "base-sepolia", unsafeNetwork: false },
        ),
      (err: unknown) => err instanceof EscrowError && /sendTransaction/.test(err.message),
    );
    await assert.rejects(
      () =>
        transferUsdcFromAccount(
          {
            address: "0x1",
            async sendTransaction() {
              return { transactionHash: "  " };
            },
          },
          {
            to: TO,
            amountAtomic: AMOUNT,
            idempotencyKey: "k",
            purpose: "hunter",
            kind: "HUNTER_PAYOUT",
          },
          { network: "base-sepolia", unsafeNetwork: false },
        ),
      (err: unknown) => err instanceof EscrowError && /no transaction hash/.test(err.message),
    );
  });
});
