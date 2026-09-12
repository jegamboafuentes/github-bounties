import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * V1 domain schema — contract for V1-2…V1-6.
 *
 * ORM: Drizzle (SQL-first, typed migrations, no runtime query engine).
 * Status names map to ADR 0001 money/coordination states where those exist.
 *
 * Winner (later tickets): author of the merged PR that closes funded issue #N.
 * Claim-lock is exclusive 72h coordination only — it does not move USDC.
 * FeeLedger.fee_bps defaults to 200 (2% of face) at settlement.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** ADR Funding / Open / ClaimLocked / Settling / Settled / SettledPartial / Refunding / Refunded / Void. */
export const bountyStatusEnum = pgEnum("bounty_status", [
  "pending_fund",
  "funded",
  "claim_locked",
  "settling",
  "settled",
  "settled_partial",
  "refunding",
  "refunded",
  "void",
  "cancelled",
  "expired",
]);

export const claimLockStatusEnum = pgEnum("claim_lock_status", [
  "active",
  "expired",
  "released",
  "consumed",
]);

export const escrowStatusEnum = pgEnum("escrow_status", [
  "pending",
  "funded",
  "settling",
  "settled",
  "settled_partial",
  "refunding",
  "refunded",
  "failed",
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "eligible",
  "paid",
  "rejected",
  "disputed",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googleSub: text("google_sub").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    walletAddress: text("wallet_address"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_google_sub_uidx").on(table.googleSub),
    index("users_email_idx").on(table.email),
    index("users_wallet_address_idx").on(table.walletAddress),
  ],
);

export const githubLinks = pgTable(
  "github_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    githubId: bigint("github_id", { mode: "bigint" }).notNull(),
    githubLogin: text("github_login").notNull(),
    githubAvatarUrl: text("github_avatar_url"),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("github_links_user_id_uidx").on(table.userId),
    uniqueIndex("github_links_github_id_uidx").on(table.githubId),
    index("github_links_github_login_idx").on(table.githubLogin),
  ],
);

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubRepoId: bigint("github_repo_id", { mode: "bigint" }).notNull(),
    fullName: text("full_name").notNull(),
    installationId: bigint("installation_id", { mode: "bigint" }).notNull(),
    connectedByUserId: uuid("connected_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repos_github_repo_id_uidx").on(table.githubRepoId),
    index("repos_full_name_idx").on(table.fullName),
    index("repos_installation_id_idx").on(table.installationId),
    index("repos_connected_by_user_id_idx").on(table.connectedByUserId),
    index("repos_is_active_idx").on(table.isActive),
  ],
);

/**
 * Active = not in a terminal money state. One open bounty per issue.
 * Terminal (new bounty allowed later): settled, refunded, void, cancelled, expired.
 */
const ACTIVE_BOUNTY_STATUSES = sql`status in (
  'pending_fund',
  'funded',
  'claim_locked',
  'settling',
  'settled_partial',
  'refunding'
)`;

export const bounties = pgTable(
  "bounties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "restrict" }),
    githubIssueNumber: integer("github_issue_number").notNull(),
    url: text("url").notNull(),
    posterUserId: uuid("poster_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountUsdc: numeric("amount_usdc", { precision: 20, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("USDC"),
    chain: text("chain").notNull().default("base"),
    status: bountyStatusEnum("status").notNull().default("pending_fund"),
    title: text("title").notNull(),
    descriptionSnapshot: text("description_snapshot"),
    fundedAt: timestamp("funded_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    /** V2 participation pool — nullable stubs only. */
    participationPoolBps: integer("participation_pool_bps"),
    participationPoolUsdc: numeric("participation_pool_usdc", {
      precision: 20,
      scale: 6,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("bounties_one_active_per_issue_uidx")
      .on(table.repoId, table.githubIssueNumber)
      .where(ACTIVE_BOUNTY_STATUSES),
    index("bounties_repo_id_idx").on(table.repoId),
    index("bounties_poster_user_id_idx").on(table.posterUserId),
    index("bounties_status_idx").on(table.status),
    index("bounties_repo_issue_idx").on(table.repoId, table.githubIssueNumber),
    check("bounties_issue_positive", sql`${table.githubIssueNumber} > 0`),
    check("bounties_amount_positive", sql`${table.amountUsdc} > 0`),
  ],
);

export const claimLocks = pgTable(
  "claim_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    hunterUserId: uuid("hunter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * When omitted, trigger `claim_locks_set_expires` sets
     * locked_at + 72 hours. Writers may pass an explicit value.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    status: claimLockStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("claim_locks_one_active_per_bounty_uidx")
      .on(table.bountyId)
      .where(sql`${table.status} = 'active'`),
    index("claim_locks_bounty_id_idx").on(table.bountyId),
    index("claim_locks_hunter_user_id_idx").on(table.hunterUserId),
    index("claim_locks_expires_at_idx").on(table.expiresAt),
    index("claim_locks_status_idx").on(table.status),
    check("claim_locks_expires_after_lock", sql`${table.expiresAt} > ${table.lockedAt}`),
  ],
);

export const escrows = pgTable(
  "escrows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    amountUsdc: numeric("amount_usdc", { precision: 20, scale: 6 }).notNull(),
    status: escrowStatusEnum("status").notNull().default("pending"),
    x402PaymentId: text("x402_payment_id"),
    x402Url: text("x402_url"),
    checkoutId: text("checkout_id"),
    fundTxHash: text("fund_tx_hash"),
    sweepTxHash: text("sweep_tx_hash"),
    payoutTxHash: text("payout_tx_hash"),
    feeTxHash: text("fee_tx_hash"),
    refundTxHash: text("refund_tx_hash"),
    escrowAddress: text("escrow_address"),
    funderAddress: text("funder_address"),
    idempotencyKey: text("idempotency_key"),
    /** Last Lock/rail failure. Null after a successful fund lock. */
    failCode: text("fail_code"),
    failReason: text("fail_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("escrows_bounty_id_uidx").on(table.bountyId),
    index("escrows_status_idx").on(table.status),
    uniqueIndex("escrows_idempotency_key_uidx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check("escrows_amount_positive", sql`${table.amountUsdc} > 0`),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    hunterUserId: uuid("hunter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: claimStatusEnum("status").notNull().default("eligible"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    /** Winner later: merged PR author (login) that closes #N. */
    prAuthorLogin: text("pr_author_login"),
    mergedAt: timestamp("merged_at", { withTimezone: true, mode: "date" }),
    mergeCommitSha: text("merge_commit_sha"),
    closedIssueNumber: integer("closed_issue_number"),
    payoutAddress: text("payout_address"),
    payoutUsdc: numeric("payout_usdc", { precision: 20, scale: 6 }),
    payoutTxHash: text("payout_tx_hash"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    rejectionReason: text("rejection_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("claims_bounty_pr_uidx")
      .on(table.bountyId, table.prNumber)
      .where(sql`${table.prNumber} is not null`),
    index("claims_bounty_id_idx").on(table.bountyId),
    index("claims_hunter_user_id_idx").on(table.hunterUserId),
    index("claims_status_idx").on(table.status),
    index("claims_pr_author_login_idx").on(table.prAuthorLogin),
  ],
);

export const feeLedger = pgTable(
  "fee_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    faceUsdc: numeric("face_usdc", { precision: 20, scale: 6 }).notNull(),
    feeUsdc: numeric("fee_usdc", { precision: 20, scale: 6 }).notNull(),
    feeBps: integer("fee_bps").notNull().default(200),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fee_ledger_bounty_id_uidx").on(table.bountyId),
    check("fee_ledger_face_positive", sql`${table.faceUsdc} > 0`),
    check("fee_ledger_fee_nonnegative", sql`${table.feeUsdc} >= 0`),
    check("fee_ledger_fee_bps_nonnegative", sql`${table.feeBps} >= 0`),
  ],
);

/** Persisted markEligible outcome — skip reasons are queryable without Cloud Logging. */
export type WebhookClaimResult = {
  issueNumber: number;
  bountyId?: string;
  claimId?: string;
  status?: string;
  skip?: string;
  prNumber?: number | null;
  winnerLogin?: string | null;
};

/**
 * GitHub delivery-id idempotency (V1-3).
 * Redeliveries keep the same `X-GitHub-Delivery` GUID.
 * `claim_results` stores Claim upserts and skip reasons (`hunter_not_linked`, …).
 */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  action: text("action"),
  eligible: boolean("eligible"),
  winnerLogin: text("winner_login"),
  pullRequestNumber: integer("pull_request_number"),
  repositoryFullName: text("repository_full_name"),
  claimResults: jsonb("claim_results").$type<WebhookClaimResult[] | null>(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const bountyStatusValues = bountyStatusEnum.enumValues;
export const claimLockStatusValues = claimLockStatusEnum.enumValues;
export const escrowStatusValues = escrowStatusEnum.enumValues;
export const claimStatusValues = claimStatusEnum.enumValues;
