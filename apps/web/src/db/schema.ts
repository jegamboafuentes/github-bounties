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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { POOL_BPS_OF_POST_FEE } from "../lib/constants";

/**
 * V1 domain schema plus additive V2-1 pool tables.
 *
 * ORM: Drizzle (SQL-first, typed migrations, no runtime query engine).
 * Status names map to ADR 0001 money/coordination states where those exist.
 *
 * Winner: author of the merged PR that closes funded issue #N.
 * Exclusive 72h claim-lock is retired (V2-4). Residual `claim_locks` drain
 * on board/detail read. Use non-exclusive `work_signals`.
 * FeeLedger.fee_bps defaults to 200 (2% of face) at settlement.
 * `bounties.participation_pool_bps` default 1500 = 15% of **post-fee**, not of face.
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

/** Frozen roster role. Winner is excluded from E; overflow is recorded, not paid. */
export const poolParticipantRoleEnum = pgEnum("pool_participant_role", [
  "winner",
  "pool",
  "overflow",
  "excluded_poster",
  "excluded_bot",
]);

/**
 * V2 settlement legs (ADR 0003 / V2-3). `FUND_IN` / `REFUND_OUT` stay on
 * the escrow row. Winner hash is also copied to `escrows.payout_tx_hash`.
 */
export const allocationLedgerKindEnum = pgEnum("allocation_ledger_kind", [
  "FEE_OUT",
  "WINNER_PAYOUT",
  "POOL_PAYOUT",
]);

export const allocationLedgerStatusEnum = pgEnum("allocation_ledger_status", [
  "pending",
  "submitted",
  "confirmed",
  "failed",
]);

/**
 * Product identity. One row per Google `google_sub` (unique).
 * Do not add a second user table — sign-in upserts this row in place.
 * `created_at` is the first successful sign-in. `last_seen_at` advances on
 * every successful sign-in. `avatar_url` is the Google picture when it is https.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googleSub: text("google_sub").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    walletAddress: text("wallet_address"),
    avatarUrl: text("avatar_url"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * Set when the one welcome outbox row is inserted (or permanently skipped).
     * Null only for a signup that has not finished enqueue yet.
     * Migration 0006 stamps existing rows to `created_at` so they are not
     * welcomed retroactively.
     */
    welcomeEnqueuedAt: timestamp("welcome_enqueued_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_google_sub_uidx").on(table.googleSub),
    index("users_email_idx").on(table.email),
    index("users_wallet_address_idx").on(table.walletAddress),
  ],
);

/**
 * Transactional email templates. Welcome is enqueued on first signup.
 * The other names are enqueued from confirmed fund lock, winning-merge
 * eligibility, and winner-share settlement. DEV only — no PROD wiring.
 */
export const EMAIL_TEMPLATE_VALUES = [
  "welcome",
  "bounty_funded",
  "pr_merged",
  "bounty_settled",
  "pool_claimable",
] as const;

export type EmailTemplateName = (typeof EMAIL_TEMPLATE_VALUES)[number];

export const EMAIL_OUTBOX_STATUSES = ["pending", "sending", "sent", "failed"] as const;

export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/** JSON stored on an outbox row. Recipients are not stored here. */
export type EmailOutboxPayload = {
  displayName?: string;
  bountyTitle?: string;
  bountyUrl?: string;
  amountLabel?: string;
  repoFullName?: string;
  issueNumber?: number;
};

/**
 * Durable send queue. Unique `idempotency_key` so retries and repeat logins
 * cannot insert a second welcome (or a second copy of a later event).
 * `to_email` is copied from `users.email` at enqueue time — never a scraped
 * GitHub address.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    payload: jsonb("payload").$type<EmailOutboxPayload>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    claimedBy: text("claimed_by"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("email_outbox_idempotency_key_uidx").on(table.idempotencyKey),
    index("email_outbox_status_created_idx").on(table.status, table.createdAt),
    index("email_outbox_user_id_idx").on(table.userId),
    check(
      "email_outbox_status",
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed')`,
    ),
    check(
      "email_outbox_template",
      sql`${table.template} in ('welcome', 'bounty_funded', 'pr_merged', 'bounty_settled', 'pool_claimable')`,
    ),
    check("email_outbox_to_email_present", sql`length(trim(${table.toEmail})) > 0`),
  ],
);

/** One GitHub account per user (`user_id` unique) and one user per GitHub id. */
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

/**
 * `app_install` — GitHub App installation webhooks own merge → Claim.
 * `public_reference` — poster referenced a public repo; no installation token.
 * `installation_id` is required for `app_install` and null for a pure public reference.
 * A later App install upgrades the same `github_repo_id` row back to `app_install`.
 */
export const repoConnectionKindEnum = pgEnum("repo_connection_kind", [
  "app_install",
  "public_reference",
]);

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubRepoId: bigint("github_repo_id", { mode: "bigint" }).notNull(),
    fullName: text("full_name").notNull(),
    installationId: bigint("installation_id", { mode: "bigint" }),
    connectionKind: repoConnectionKindEnum("connection_kind")
      .notNull()
      .default("app_install"),
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
    index("repos_connection_kind_idx").on(table.connectionKind),
    index("repos_connected_by_user_id_idx").on(table.connectedByUserId),
    index("repos_is_active_idx").on(table.isActive),
    check(
      "repos_app_install_requires_installation",
      sql`${table.connectionKind} <> 'app_install' OR ${table.installationId} IS NOT NULL`,
    ),
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
    /** Last successful GitHub issue-body sync (create or detail refresh). */
    issueBodySyncedAt: timestamp("issue_body_synced_at", {
      withTimezone: true,
      mode: "date",
    }),
    fundedAt: timestamp("funded_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    /**
     * ADR 0003 / V2-1: **1500 = 15% of post-fee** (not 15% of face).
     * `pool_atomic = |E|=0 ? 0 : floor(post_fee × 1500 / 10_000)`.
     * Nullable so pre-V2 rows stay valid; new inserts default 1500.
     */
    participationPoolBps: integer("participation_pool_bps").default(
      POOL_BPS_OF_POST_FEE,
    ),
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
    /** Winner hash for V1 readers. Pool hashes live on allocation_ledger / pool_participants. */
    payoutTxHash: text("payout_tx_hash"),
    feeTxHash: text("fee_tx_hash"),
    refundTxHash: text("refund_tx_hash"),
    escrowAddress: text("escrow_address"),
    funderAddress: text("funder_address"),
    idempotencyKey: text("idempotency_key"),
    /** Last Lock/settle/rail failure. Null after a successful fund lock or full settle. */
    failCode: text("fail_code"),
    failReason: text("fail_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("escrows_bounty_id_uidx").on(table.bountyId),
    uniqueIndex("escrows_fund_tx_hash_uidx")
      .on(table.fundTxHash)
      .where(sql`${table.fundTxHash} is not null`),
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
    /** Winner: merged PR author (login) that closes #N. Pool members are not claims rows. */
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

/**
 * Frozen eligible set + equal shares (ADR 0003 / V2-1).
 *
 * Unique `(bounty_id, github_id)`. `user_id` is null until `github_links`.
 * Overflow / excluded rows have `share_usdc = 0`. Pool members are **not**
 * `claims` rows — `claims` stays winner-only.
 */
export const poolParticipants = pgTable(
  "pool_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    githubId: bigint("github_id", { mode: "bigint" }).notNull(),
    githubLogin: text("github_login").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    role: poolParticipantRoleEnum("role").notNull(),
    qualifyingPrNumber: integer("qualifying_pr_number"),
    qualifyingPrCreatedAt: timestamp("qualifying_pr_created_at", {
      withTimezone: true,
      mode: "date",
    }),
    qualifyingPrUrl: text("qualifying_pr_url"),
    /** One commit of theirs on the qualifying PR at freeze. No reflog. */
    commitSha: text("commit_sha"),
    frozenAt: timestamp("frozen_at", { withTimezone: true, mode: "date" }),
    shareUsdc: numeric("share_usdc", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    payoutAddress: text("payout_address"),
    payoutTxHash: text("payout_tx_hash"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    skipReason: text("skip_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pool_participants_bounty_github_uidx").on(
      table.bountyId,
      table.githubId,
    ),
    index("pool_participants_bounty_id_idx").on(table.bountyId),
    index("pool_participants_user_id_idx").on(table.userId),
    index("pool_participants_role_idx").on(table.role),
    check("pool_participants_share_nonnegative", sql`${table.shareUsdc} >= 0`),
  ],
);

/**
 * One ledger row per intended V2 chain movement (fee, winner, each pool member).
 *
 * Unique `(bounty_id, kind, participant_id)` with `NULLS NOT DISTINCT` so a
 * single `FEE_OUT` (null participant) is allowed per bounty.
 * Unique `idempotency_key` for CDP retries (V2-3). Empty pool: no `POOL_PAYOUT`.
 */
export const allocationLedger = pgTable(
  "allocation_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id").references(() => poolParticipants.id, {
      onDelete: "restrict",
    }),
    kind: allocationLedgerKindEnum("kind").notNull(),
    amountUsdc: numeric("amount_usdc", { precision: 20, scale: 6 }).notNull(),
    toAddress: text("to_address"),
    idempotencyKey: text("idempotency_key").notNull(),
    txHash: text("tx_hash"),
    status: allocationLedgerStatusEnum("status").notNull().default("pending"),
    ...timestamps,
  },
  (table) => [
    unique("allocation_ledger_bounty_kind_participant_uidx")
      .on(table.bountyId, table.kind, table.participantId)
      .nullsNotDistinct(),
    uniqueIndex("allocation_ledger_idempotency_key_uidx").on(
      table.idempotencyKey,
    ),
    index("allocation_ledger_bounty_id_idx").on(table.bountyId),
    index("allocation_ledger_participant_id_idx").on(table.participantId),
    index("allocation_ledger_status_idx").on(table.status),
    check("allocation_ledger_amount_positive", sql`${table.amountUsdc} > 0`),
  ],
);

/**
 * Optional non-blocking “working on this” signal (ADR 0003).
 *
 * Many rows per bounty and per `(bounty_id, user_id)`. **No exclusive unique
 * index** — this is not a claim-lock and not a money row. V2-4 UI writes these
 * instead of `claim_locks`.
 */
export const workSignals = pgTable(
  "work_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signaledAt: timestamp("signaled_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [
    index("work_signals_bounty_id_idx").on(table.bountyId),
    index("work_signals_user_id_idx").on(table.userId),
    index("work_signals_bounty_user_idx").on(table.bountyId, table.userId),
  ],
);

/**
 * Cached Gemini bounty intelligence (V3-0). Keyed by bounty.
 * Refresh: first detail read after create, stale TTL, source fingerprint
 * change (issue body / repo metadata), or `?refreshIntelligence=1`.
 * Missing GEMINI_API_KEY does not write a row — UI degrades.
 */
export const bountyIntelligence = pgTable(
  "bounty_intelligence",
  {
    bountyId: uuid("bounty_id")
      .primaryKey()
      .references(() => bounties.id, { onDelete: "restrict" }),
    repoAbout: text("repo_about"),
    languageStack: text("language_stack"),
    complexity: text("complexity"),
    model: text("model"),
    sourceFingerprint: text("source_fingerprint"),
    status: text("status").notNull().default("ready"),
    errorReason: text("error_reason"),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    index("bounty_intelligence_generated_at_idx").on(table.generatedAt),
    check(
      "bounty_intelligence_complexity_sml",
      sql`${table.complexity} is null or ${table.complexity} in ('S', 'M', 'L')`,
    ),
    check(
      "bounty_intelligence_status",
      sql`${table.status} in ('ready', 'error')`,
    ),
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
 * One inbound USDC credit toward a bounty face (first Lock or a later top-up).
 *
 * Face on `bounties` / `escrows` is the sum of these rows. Fee and pool math
 * stay 2% of that face and 15% of post-fee — this table is attribution only.
 * `refund_tx_hash` is set when a multi-funder cancel returns that row's amount.
 */
export const bountyContributions = pgTable(
  "bounty_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id, { onDelete: "restrict" }),
    funderUserId: uuid("funder_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountUsdc: numeric("amount_usdc", { precision: 20, scale: 6 }).notNull(),
    fundTxHash: text("fund_tx_hash").notNull(),
    funderAddress: text("funder_address"),
    refundTxHash: text("refund_tx_hash"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("bounty_contributions_bounty_tx_uidx").on(table.bountyId, table.fundTxHash),
    uniqueIndex("bounty_contributions_fund_tx_hash_uidx")
      .on(table.fundTxHash)
      .where(sql`${table.fundTxHash} is not null`),
    index("bounty_contributions_bounty_id_idx").on(table.bountyId),
    index("bounty_contributions_funder_user_id_idx").on(table.funderUserId),
    check("bounty_contributions_amount_positive", sql`${table.amountUsdc} > 0`),
  ],
);

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

export const repoConnectionKindValues = repoConnectionKindEnum.enumValues;
export const bountyStatusValues = bountyStatusEnum.enumValues;
export const claimLockStatusValues = claimLockStatusEnum.enumValues;
export const escrowStatusValues = escrowStatusEnum.enumValues;
export const claimStatusValues = claimStatusEnum.enumValues;
export const poolParticipantRoleValues = poolParticipantRoleEnum.enumValues;
export const allocationLedgerKindValues = allocationLedgerKindEnum.enumValues;
export const allocationLedgerStatusValues = allocationLedgerStatusEnum.enumValues;
