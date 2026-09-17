CREATE TYPE "public"."allocation_ledger_kind" AS ENUM('FEE_OUT', 'WINNER_PAYOUT', 'POOL_PAYOUT');--> statement-breakpoint
CREATE TYPE "public"."allocation_ledger_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pool_participant_role" AS ENUM('winner', 'pool', 'overflow', 'excluded_poster', 'excluded_bot');--> statement-breakpoint
CREATE TABLE "allocation_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"participant_id" uuid,
	"kind" "allocation_ledger_kind" NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"to_address" text,
	"idempotency_key" text NOT NULL,
	"tx_hash" text,
	"status" "allocation_ledger_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_ledger_bounty_kind_participant_uidx" UNIQUE NULLS NOT DISTINCT("bounty_id","kind","participant_id"),
	CONSTRAINT "allocation_ledger_amount_positive" CHECK ("allocation_ledger"."amount_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE "pool_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"user_id" uuid,
	"role" "pool_participant_role" NOT NULL,
	"qualifying_pr_number" integer,
	"qualifying_pr_created_at" timestamp with time zone,
	"qualifying_pr_url" text,
	"commit_sha" text,
	"frozen_at" timestamp with time zone,
	"share_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"payout_address" text,
	"payout_tx_hash" text,
	"paid_at" timestamp with time zone,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_participants_share_nonnegative" CHECK ("pool_participants"."share_usdc" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signaled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bounties" ALTER COLUMN "participation_pool_bps" SET DEFAULT 1500;--> statement-breakpoint
ALTER TABLE "allocation_ledger" ADD CONSTRAINT "allocation_ledger_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_ledger" ADD CONSTRAINT "allocation_ledger_participant_id_pool_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."pool_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_participants" ADD CONSTRAINT "pool_participants_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_participants" ADD CONSTRAINT "pool_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_signals" ADD CONSTRAINT "work_signals_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_signals" ADD CONSTRAINT "work_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_ledger_idempotency_key_uidx" ON "allocation_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "allocation_ledger_bounty_id_idx" ON "allocation_ledger" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "allocation_ledger_participant_id_idx" ON "allocation_ledger" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "allocation_ledger_status_idx" ON "allocation_ledger" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_participants_bounty_github_uidx" ON "pool_participants" USING btree ("bounty_id","github_id");--> statement-breakpoint
CREATE INDEX "pool_participants_bounty_id_idx" ON "pool_participants" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "pool_participants_user_id_idx" ON "pool_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pool_participants_role_idx" ON "pool_participants" USING btree ("role");--> statement-breakpoint
CREATE INDEX "work_signals_bounty_id_idx" ON "work_signals" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "work_signals_user_id_idx" ON "work_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_signals_bounty_user_idx" ON "work_signals" USING btree ("bounty_id","user_id");
--> statement-breakpoint
COMMENT ON COLUMN "bounties"."participation_pool_bps" IS '1500 = 15% of post-fee (ADR 0003), not 15% of face.';
--> statement-breakpoint
UPDATE "bounties" SET "participation_pool_bps" = 1500 WHERE "participation_pool_bps" IS NULL;