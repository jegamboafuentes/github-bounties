import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { createDb, type Database } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { loadDotenvFiles } from "../db/load-dotenv";
import { feeWithdrawals, withdrawConfirmTokens } from "../db/schema";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "../lib/constants";
import { AdminError } from "./errors";
import type { NamedAccount, NamedAccountClient } from "./fee-account";
import { executeFeeWithdraw, previewFeeWithdraw } from "./withdraw";

loadDotenvFiles();

const FEE = getAddress("0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8");
const ESCROW = getAddress("0x4a26235bf51c73048635d607EB5371E9b3e611B8");
const DEST = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const SECRET = "test-withdraw-secret-32";
const ENV = {
  ADMIN_WITHDRAW_ENABLED: "1",
  CDP_NETWORK: "base-sepolia",
  FEE_WALLET_ADDRESS: FEE,
  AUTH_SECRET: SECRET,
};

function client(sendTransaction: NonNullable<NamedAccount["sendTransaction"]>): NamedAccountClient {
  return {
    async getAccount({ name }) {
      return { address: name === "gb-fee" ? FEE : ESCROW, sendTransaction };
    },
  };
}

async function cleanup(db: Database) {
  await db.delete(feeWithdrawals).where(eq(feeWithdrawals.feeAddress, FEE));
  await db.delete(withdrawConfirmTokens).where(eq(withdrawConfirmTokens.feeAddress, FEE));
}

describe("fee withdraw single use", { concurrency: 1 }, () => {
  it("enforces one token hash and one in-flight row per fee wallet", async () => {
    const { db, sql } = createDb();
    const expiresAt = new Date(Date.now() + 60_000);
    const base = {
      amountAtomic: "1000000",
      destination: DEST,
      network: "base-sepolia",
      adminEmail: "ada@example.com",
      feeAddress: FEE,
      expiresAt,
    };
    try {
      await cleanup(db);
      const first = randomUUID();
      const second = randomUUID();
      await db.insert(withdrawConfirmTokens).values({ ...base, id: first, tokenHash: `hash-${first}` });
      await assert.rejects(
        () => db.insert(withdrawConfirmTokens).values({ ...base, id: second, tokenHash: `hash-${first}` }),
        isUniqueViolation,
      );
      await db.insert(withdrawConfirmTokens).values({ ...base, id: second, tokenHash: `hash-${second}` });
      await db.insert(feeWithdrawals).values({
        tokenId: first,
        idempotencyKey: first,
        feeAddress: FEE,
        destination: DEST,
        amountAtomic: "1000000",
        network: "base-sepolia",
        status: "pending",
      });
      await assert.rejects(
        () =>
          db.insert(feeWithdrawals).values({
            tokenId: second,
            idempotencyKey: second,
            feeAddress: FEE,
            destination: DEST,
            amountAtomic: "1000000",
            network: "base-sepolia",
            status: "pending",
          }),
        isUniqueViolation,
      );
    } finally {
      await cleanup(db).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });

  it("executes one concurrent confirm and returns 409 when that token is reused", async () => {
    const a = createDb();
    const b = createDb();
    let calls = 0;
    const transfer: NonNullable<NamedAccount["sendTransaction"]> = async () => {
      calls += 1;
      return { transactionHash: "0xonce" };
    };
    try {
      await cleanup(a.db);
      const preview = await previewFeeWithdraw({
        db: a.db,
        env: ENV,
        actorEmail: "Ada@Example.com",
        amountUsdc: "3.000001",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const run = (db: Database) =>
        executeFeeWithdraw({
          db,
          env: ENV,
          actorEmail: "ada@example.com",
          confirmToken: preview.confirmToken,
          confirmation: DEST,
          client: client(transfer),
          readBalance: async () => 10_000_000n,
        });
      const [left, right] = await Promise.allSettled([run(a.db), run(b.db)]);
      const fulfilled = [left, right].filter((item) => item.status === "fulfilled");
      const rejected = [left, right].filter((item) => item.status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(calls, 1);
      const reason = rejected[0]?.status === "rejected" ? rejected[0].reason : null;
      assert.ok(reason instanceof AdminError);
      assert.equal(reason.status, 409);
      assert.equal(reason.code, "withdraw_token_used");
      if (fulfilled[0]?.status === "fulfilled") assert.equal(fulfilled[0].value.txHash, "0xonce");

      await assert.rejects(
        () => run(a.db),
        (err: unknown) => err instanceof AdminError && err.status === 409 && err.code === "withdraw_token_used",
      );
      assert.equal(calls, 1);
      const [row] = await a.db
        .select()
        .from(feeWithdrawals)
        .where(eq(feeWithdrawals.destination, DEST));
      assert.equal(row?.status, "ok");
      assert.equal(row?.idempotencyKey, row?.tokenId);
      const [token] = await a.db
        .select()
        .from(withdrawConfirmTokens)
        .where(eq(withdrawConfirmTokens.id, row!.tokenId));
      assert.ok(token?.usedAt);
    } finally {
      await cleanup(a.db).catch(() => undefined);
      await a.sql.end({ timeout: 5 });
      await b.sql.end({ timeout: 5 });
    }
  });

  it("refuses a second token while a withdraw is in flight", async () => {
    const a = createDb();
    const b = createDb();
    let calls = 0;
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const transfer: NonNullable<NamedAccount["sendTransaction"]> = async () => {
      calls += 1;
      markStarted();
      await hold;
      return { transactionHash: "0xheld" };
    };
    let pending: ReturnType<typeof executeFeeWithdraw> = Promise.resolve({
      txHash: "",
      amountUsdc: "",
      destination: DEST,
      network: "base-sepolia",
    });
    try {
      await cleanup(a.db);
      const previewA = await previewFeeWithdraw({
        db: a.db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "3.000002",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const previewB = await previewFeeWithdraw({
        db: a.db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "3.000003",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      pending = executeFeeWithdraw({
        db: a.db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: previewA.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      await Promise.race([
        started,
        new Promise((_, reject) => setTimeout(() => reject(new Error("transfer did not start")), 5_000)),
      ]);
      const blocked = await executeFeeWithdraw({
        db: b.db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: previewB.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      assert.ok(blocked instanceof AdminError);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.code, "withdraw_in_flight");
      assert.equal(calls, 1);
      release();
      const sent = await pending;
      assert.equal(sent.txHash, "0xheld");
      assert.equal(calls, 1);
      const sentB = await executeFeeWithdraw({
        db: b.db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: previewB.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      assert.equal(sentB.txHash, "0xheld");
      assert.equal(calls, 2);
    } finally {
      release();
      await pending.catch(() => undefined);
      await cleanup(a.db).catch(() => undefined);
      await a.sql.end({ timeout: 5 });
      await b.sql.end({ timeout: 5 });
    }
  });

  it("consumes the token when the send fails and does not retry it", async () => {
    const { db, sql } = createDb();
    let calls = 0;
    const transfer: NonNullable<NamedAccount["sendTransaction"]> = async () => {
      calls += 1;
      if (calls === 1) throw new Error("Insufficient balance");
      return { transactionHash: "0xfunded" };
    };
    try {
      await cleanup(db);
      const preview = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "1.340000",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const failed = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: preview.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      assert.ok(failed instanceof AdminError);
      assert.equal(failed.status, 502);
      assert.equal(failed.code, "fee_transfer_failed");
      assert.match(failed.message, /Insufficient balance/);
      assert.equal(calls, 1);
      await assert.rejects(
        () =>
          executeFeeWithdraw({
            db,
            env: ENV,
            actorEmail: "ada@example.com",
            confirmToken: preview.confirmToken,
            confirmation: DEST,
            client: client(transfer),
            readBalance: async () => 10_000_000n,
          }),
        (err: unknown) => err instanceof AdminError && err.status === 409 && err.code === "withdraw_token_used",
      );
      assert.equal(calls, 1);
      const [failedRow] = await db.select().from(feeWithdrawals).where(eq(feeWithdrawals.amountAtomic, "1340000"));
      assert.equal(failedRow?.status, "failed");

      const again = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "1.340000",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const sent = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: again.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      assert.equal(sent.txHash, "0xfunded");
      assert.equal(calls, 2);
    } finally {
      await cleanup(db).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });

  it("blocks the same amount and destination for 10 minutes unless sendAgain is set", async () => {
    const { db, sql } = createDb();
    let calls = 0;
    const transfer: NonNullable<NamedAccount["sendTransaction"]> = async () => {
      calls += 1;
      return { transactionHash: `0xdup${calls}` };
    };
    try {
      await cleanup(db);
      const first = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "4.000004",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: first.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const second = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "4.000004",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const duplicate = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: second.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      assert.ok(duplicate instanceof AdminError);
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.code, "withdraw_duplicate_recent");
      assert.equal(calls, 1);
      const [unused] = await db
        .select({ usedAt: withdrawConfirmTokens.usedAt })
        .from(withdrawConfirmTokens)
        .where(eq(withdrawConfirmTokens.amountAtomic, "4000004"));
      const unusedRows = await db
        .select()
        .from(withdrawConfirmTokens)
        .where(eq(withdrawConfirmTokens.amountAtomic, "4000004"));
      assert.equal(unusedRows.filter((row) => row.usedAt).length, 1);
      assert.equal(unusedRows.filter((row) => !row.usedAt).length, 1);
      assert.equal(unused?.usedAt == null || unusedRows.some((row) => !row.usedAt), true);

      const sent = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: second.confirmToken,
        confirmation: DEST,
        sendAgain: true,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      assert.equal(sent.txHash, "0xdup2");
      assert.equal(calls, 2);
    } finally {
      await cleanup(db).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });

  it("records an unknown send and does not retry or start another withdraw", async () => {
    const { db, sql } = createDb();
    let calls = 0;
    const transfer: NonNullable<NamedAccount["sendTransaction"]> = async () => {
      calls += 1;
      throw new Error("The request timed out");
    };
    try {
      await cleanup(db);
      const preview = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "5.000005",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const unknown = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: preview.confirmToken,
        confirmation: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      assert.ok(unknown instanceof AdminError);
      assert.equal(unknown.status, 502);
      assert.equal(unknown.code, "withdraw_outcome_unknown");
      assert.match(unknown.message, /not retried/);
      assert.equal(calls, 1);
      const [row] = await db.select().from(feeWithdrawals).where(eq(feeWithdrawals.amountAtomic, "5000005"));
      assert.equal(row?.status, "unknown");

      const other = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "5.000006",
        destination: DEST,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      });
      const blocked = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: other.confirmToken,
        confirmation: DEST,
        sendAgain: true,
        client: client(transfer),
        readBalance: async () => 10_000_000n,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      assert.ok(blocked instanceof AdminError);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.code, "withdraw_in_flight");
      assert.equal(calls, 1);
    } finally {
      await cleanup(db).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });

  it("forwards the withdraw idempotency key and sepolia USDC calldata", async () => {
    const { db, sql } = createDb();
    const seen: { idempotencyKey: string; to: string; data: string; network: string }[] = [];
    const sendTransaction: NonNullable<NamedAccount["sendTransaction"]> = async (args) => {
      seen.push({
        idempotencyKey: args.idempotencyKey,
        to: args.transaction.to,
        data: args.transaction.data,
        network: args.network,
      });
      return { transactionHash: "0xkeyed" };
    };
    try {
      await cleanup(db);
      const preview = await previewFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        amountUsdc: "6.000006",
        destination: DEST,
        client: client(sendTransaction),
        readBalance: async () => 10_000_000n,
      });
      const sent = await executeFeeWithdraw({
        db,
        env: ENV,
        actorEmail: "ada@example.com",
        confirmToken: preview.confirmToken,
        confirmation: DEST,
        client: client(sendTransaction),
        readBalance: async () => 10_000_000n,
      });
      assert.equal(sent.txHash, "0xkeyed");
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.network, "base-sepolia");
      assert.equal(seen[0]?.to, USDC_BASE_SEPOLIA);
      const [row] = await db.select().from(feeWithdrawals).where(eq(feeWithdrawals.amountAtomic, "6000006"));
      assert.equal(seen[0]?.idempotencyKey, row?.idempotencyKey);
      assert.equal(seen[0]?.idempotencyKey, row?.tokenId);
      const plain = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [DEST, 6_000_006n],
      });
      assert.equal(seen[0]?.data, plain);
      assert.notEqual(seen[0]?.to, USDC_BASE_MAINNET);
    } finally {
      await cleanup(db).catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });
});
