import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";
import { AdminError } from "./errors";
import type { NamedAccountClient } from "./fee-account";
import {
  assertWithdrawDestination,
  assertWithdrawEnabled,
  assertWithinBalance,
  checksummedAddress,
  pinnedWithdrawNetwork,
  withdrawEnabled,
} from "./withdraw-guards";
import { issueWithdrawToken, readWithdrawToken } from "./withdraw-token";
import { classifyFeeTransferFailure, executeFeeWithdraw, previewFeeWithdraw } from "./withdraw";

const FEE = getAddress("0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8");
const ESCROW = getAddress("0x4a26235bf51c73048635d607EB5371E9b3e611B8");
const DEST = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const SECRET = "test-withdraw-secret-32";

const dir = dirname(fileURLToPath(import.meta.url));

function memoryDb() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    insert() {
      return {
        values(value: Record<string, unknown>) {
          const row = { id: `audit-${rows.length + 1}`, ...value };
          rows.push(row);
          return {
            returning() {
              return Promise.resolve([{ id: row.id }]);
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where() {
              const last = rows[rows.length - 1];
              if (last) Object.assign(last, patch);
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
}

function client(opts?: { mismatch?: boolean; calls?: string[] }): NamedAccountClient & { getOrCreateAccount: () => Promise<never> } {
  return {
    async getAccount({ name }) {
      opts?.calls?.push(name);
      const address = name === "gb-fee" ? (opts?.mismatch ? DEST : FEE) : ESCROW;
      return {
        address,
        sendTransaction: async () => ({ transactionHash: "0xfeed" }),
      };
    },
    async getOrCreateAccount() {
      throw new Error("getOrCreateAccount must not be called");
    },
  };
}

describe("fee withdraw guards", () => {
  it("stays off unless ADMIN_WITHDRAW_ENABLED=1, even if money is enabled", () => {
    assert.equal(withdrawEnabled({ API_MONEY_ENABLED: "1" }), false);
    assert.equal(withdrawEnabled({ ADMIN_WITHDRAW_ENABLED: "true", API_MONEY_ENABLED: "1" }), false);
    assert.throws(() => assertWithdrawEnabled({ API_MONEY_ENABLED: "1" }), (err: unknown) => {
      return err instanceof AdminError && err.code === "withdraw_disabled";
    });
    assert.equal(withdrawEnabled({ ADMIN_WITHDRAW_ENABLED: "1" }), true);
  });

  it("pins the service network and refuses mainnet without the allow flag", () => {
    assert.equal(pinnedWithdrawNetwork({ CDP_NETWORK: "base-sepolia" }, "base-sepolia"), "base-sepolia");
    assert.throws(
      () => pinnedWithdrawNetwork({ CDP_NETWORK: "base-sepolia" }, "base"),
      (err: unknown) => err instanceof AdminError && err.code === "network_mismatch",
    );
    assert.throws(
      () => pinnedWithdrawNetwork({ CDP_NETWORK: "base" }),
      (err: unknown) => err instanceof AdminError && err.code === "mainnet_not_allowed",
    );
    assert.equal(pinnedWithdrawNetwork({ CDP_NETWORK: "base", CDP_ALLOW_MAINNET: "1" }), "base");
  });

  it("requires a checksum and refuses escrow, fee, and the zero address", () => {
    assert.equal(checksummedAddress(DEST), DEST);
    assert.throws(() => checksummedAddress(DEST.toLowerCase()), AdminError);
    assert.throws(() => assertWithdrawDestination(ESCROW, [ESCROW, FEE]), (err: unknown) => {
      return err instanceof AdminError && err.code === "destination_refused";
    });
    assert.throws(() => assertWithdrawDestination(FEE, [ESCROW, FEE]), AdminError);
    assert.throws(
      () => assertWithdrawDestination("0x0000000000000000000000000000000000000000", [ESCROW, FEE]),
      AdminError,
    );
    assert.equal(assertWithdrawDestination(DEST, [ESCROW, FEE]), DEST);
  });

  it("refuses an amount above the on-chain fee balance", () => {
    assert.throws(() => assertWithinBalance(2n, 1n), (err: unknown) => {
      return err instanceof AdminError && err.code === "insufficient_fee_balance";
    });
    assert.doesNotThrow(() => assertWithinBalance(1n, 1n));
  });

  it("rejects a bad or expired confirm token and never calls getOrCreateAccount", async () => {
    const calls: string[] = [];
    const accounts = client({ calls });
    const db = memoryDb();
    const env = {
      ADMIN_WITHDRAW_ENABLED: "1",
      CDP_NETWORK: "base-sepolia",
      FEE_WALLET_ADDRESS: FEE,
      AUTH_SECRET: SECRET,
      API_MONEY_ENABLED: "1",
    };
    const preview = await previewFeeWithdraw({
      db: db as never,
      env,
      actorEmail: "Ada@Example.com",
      amountUsdc: "0.100000",
      destination: DEST,
      client: accounts,
      readBalance: async () => 1_000_000n,
      now: new Date("2026-10-01T12:00:00.000Z"),
    });
    assert.deepEqual(calls, ["gb-fee", "gb-escrow"]);
    assert.equal(accounts.getOrCreateAccount, accounts.getOrCreateAccount);

    await assert.rejects(
      () =>
        executeFeeWithdraw({
          db: db as never,
          env,
          actorEmail: "ada@example.com",
          confirmToken: "not-a-token",
          confirmation: DEST,
          client: accounts,
          readBalance: async () => 1_000_000n,
          now: new Date("2026-10-01T12:00:00.000Z"),
        }),
      (err: unknown) => err instanceof AdminError && err.code === "confirm_token_invalid",
    );

    const expired = issueWithdrawToken(
      {
        id: "00000000-0000-4000-8000-0000000000aa",
        amountAtomic: "100000",
        destination: DEST,
        network: "base-sepolia",
        adminEmail: "ada@example.com",
      },
      SECRET,
      new Date("2026-10-01T11:00:00.000Z").getTime(),
    );
    assert.equal(
      readWithdrawToken(expired.token, SECRET, new Date("2026-10-01T12:00:00.000Z").getTime()),
      null,
    );

    const sent = await executeFeeWithdraw({
      db: db as never,
      env,
      actorEmail: "ada@example.com",
      confirmToken: preview.confirmToken,
      confirmation: DEST,
      callerNetwork: "base",
      client: accounts,
      readBalance: async () => 1_000_000n,
      now: new Date("2026-10-01T12:00:00.000Z"),
    }).catch((err: unknown) => err);
    assert.ok(sent instanceof AdminError && sent.code === "network_mismatch");

    assert.equal(calls.includes("gb-fee"), true);
    assert.equal(calls.includes("getOrCreateAccount"), false);
    assert.equal(preview.confirmToken.includes("."), true);

    const source = readFileSync(join(dir, "fee-account.ts"), "utf8");
    assert.equal(source.includes("getOrCreateAccount"), false);
    assert.match(source, /getAccount/);
    const withdrawSource = readFileSync(join(dir, "withdraw.ts"), "utf8");
    assert.equal(withdrawSource.includes("transferUsdc"), false);
    assert.equal(withdrawSource.includes("getOrCreateAccount"), false);
    const consumeAt = withdrawSource.indexOf("usedAt: input.now");
    const transferAt = withdrawSource.indexOf("sendUsdcTransfer(");
    assert.ok(consumeAt > 0 && transferAt > consumeAt);
    assert.equal(withdrawSource.match(/sendUsdcTransfer\(/g)?.length, 1);
    assert.equal(withdrawSource.includes("accounts.fee.transfer"), false);
    assert.equal(/for\s*\(|while\s*\(/.test(withdrawSource.slice(transferAt)), false);
    const feeSource = readFileSync(join(dir, "fee-account.ts"), "utf8");
    assert.match(feeSource, /account\.sendTransaction\.bind/);
    assert.equal(feeSource.includes("account.transfer"), false);
  });

  it("treats a gas rejection as a failed send and a timeout as unknown", () => {
    const gas = classifyFeeTransferFailure(new Error("Insufficient balance"));
    assert.equal(gas.status, "failed");
    assert.equal(gas.code, "fee_transfer_failed");
    assert.match(gas.message, /Insufficient balance/);
    const timeout = classifyFeeTransferFailure(new Error("request timed out"));
    assert.equal(timeout.status, "unknown");
    assert.equal(timeout.code, "withdraw_outcome_unknown");
    assert.match(timeout.message, /not retried/);
  });

  it("rejects an invalid builder code before loading the fee account", async () => {
    let loaded = false;
    const accounts: NamedAccountClient = {
      async getAccount() {
        loaded = true;
        return { address: FEE, sendTransaction: async () => ({ transactionHash: "0xfeed" }) };
      },
    };
    const err = await executeFeeWithdraw({
      db: memoryDb() as never,
      env: {
        ADMIN_WITHDRAW_ENABLED: "1",
        CDP_NETWORK: "base-sepolia",
        FEE_WALLET_ADDRESS: FEE,
        AUTH_SECRET: SECRET,
        BASE_BUILDER_CODE: "NOT-A-CODE",
      },
      actorEmail: "ada@example.com",
      confirmToken: "unused",
      confirmation: DEST,
      client: accounts,
      readBalance: async () => 1n,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(err instanceof AdminError);
    assert.equal(err.status, 500);
    assert.equal(err.code, "builder_code_invalid");
    assert.equal(loaded, false);
  });

  it("aborts when the fee account address does not match FEE_WALLET_ADDRESS", async () => {
    await assert.rejects(
      () =>
        previewFeeWithdraw({
          db: memoryDb() as never,
          env: {
            ADMIN_WITHDRAW_ENABLED: "1",
            CDP_NETWORK: "base-sepolia",
            FEE_WALLET_ADDRESS: FEE,
            AUTH_SECRET: SECRET,
          },
          actorEmail: "ada@example.com",
          amountUsdc: "0.1",
          destination: DEST,
          client: client({ mismatch: true }),
          readBalance: async () => 1_000_000n,
        }),
      (err: unknown) => err instanceof AdminError && err.code === "fee_address_mismatch",
    );
  });
});
