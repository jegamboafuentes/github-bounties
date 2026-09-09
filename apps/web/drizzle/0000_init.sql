CREATE TYPE "public"."bounty_status" AS ENUM('pending_fund', 'funded', 'claim_locked', 'settling', 'settled', 'settled_partial', 'refunding', 'refunded', 'void', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."claim_lock_status" AS ENUM('active', 'expired', 'released', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('eligible', 'paid', 'rejected', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('pending', 'funded', 'settling', 'settled', 'settled_partial', 'refunding', 'refunded', 'failed');--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"github_issue_number" integer NOT NULL,
	"url" text NOT NULL,
	"poster_user_id" uuid NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"chain" text DEFAULT 'base' NOT NULL,
	"status" "bounty_status" DEFAULT 'pending_fund' NOT NULL,
	"title" text NOT NULL,
	"description_snapshot" text,
	"funded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"participation_pool_bps" integer,
	"participation_pool_usdc" numeric(20, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounties_issue_positive" CHECK ("bounties"."github_issue_number" > 0),
	CONSTRAINT "bounties_amount_positive" CHECK ("bounties"."amount_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE "claim_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"hunter_user_id" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "claim_lock_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_locks_expires_after_lock" CHECK ("claim_locks"."expires_at" > "claim_locks"."locked_at")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"hunter_user_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'eligible' NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"pr_author_login" text,
	"merged_at" timestamp with time zone,
	"merge_commit_sha" text,
	"closed_issue_number" integer,
	"payout_address" text,
	"payout_usdc" numeric(20, 6),
	"payout_tx_hash" text,
	"paid_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"status" "escrow_status" DEFAULT 'pending' NOT NULL,
	"x402_payment_id" text,
	"x402_url" text,
	"checkout_id" text,
	"fund_tx_hash" text,
	"sweep_tx_hash" text,
	"payout_tx_hash" text,
	"fee_tx_hash" text,
	"refund_tx_hash" text,
	"escrow_address" text,
	"funder_address" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escrows_amount_positive" CHECK ("escrows"."amount_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"face_usdc" numeric(20, 6) NOT NULL,
	"fee_usdc" numeric(20, 6) NOT NULL,
	"fee_bps" integer DEFAULT 200 NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_ledger_face_positive" CHECK ("fee_ledger"."face_usdc" > 0),
	CONSTRAINT "fee_ledger_fee_nonnegative" CHECK ("fee_ledger"."fee_usdc" >= 0),
	CONSTRAINT "fee_ledger_fee_bps_nonnegative" CHECK ("fee_ledger"."fee_bps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "github_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"github_avatar_url" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"connected_by_user_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"wallet_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_poster_user_id_users_id_fk" FOREIGN KEY ("poster_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_locks" ADD CONSTRAINT "claim_locks_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_locks" ADD CONSTRAINT "claim_locks_hunter_user_id_users_id_fk" FOREIGN KEY ("hunter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_hunter_user_id_users_id_fk" FOREIGN KEY ("hunter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_links" ADD CONSTRAINT "github_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bounties_one_active_per_issue_uidx" ON "bounties" USING btree ("repo_id","github_issue_number") WHERE status in (
  'pending_fund',
  'funded',
  'claim_locked',
  'settling',
  'settled_partial',
  'refunding'
);--> statement-breakpoint
CREATE INDEX "bounties_repo_id_idx" ON "bounties" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "bounties_poster_user_id_idx" ON "bounties" USING btree ("poster_user_id");--> statement-breakpoint
CREATE INDEX "bounties_status_idx" ON "bounties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bounties_repo_issue_idx" ON "bounties" USING btree ("repo_id","github_issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_locks_one_active_per_bounty_uidx" ON "claim_locks" USING btree ("bounty_id") WHERE "claim_locks"."status" = 'active';--> statement-breakpoint
CREATE INDEX "claim_locks_bounty_id_idx" ON "claim_locks" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "claim_locks_hunter_user_id_idx" ON "claim_locks" USING btree ("hunter_user_id");--> statement-breakpoint
CREATE INDEX "claim_locks_expires_at_idx" ON "claim_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "claim_locks_status_idx" ON "claim_locks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_bounty_pr_uidx" ON "claims" USING btree ("bounty_id","pr_number") WHERE "claims"."pr_number" is not null;--> statement-breakpoint
CREATE INDEX "claims_bounty_id_idx" ON "claims" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "claims_hunter_user_id_idx" ON "claims" USING btree ("hunter_user_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claims_pr_author_login_idx" ON "claims" USING btree ("pr_author_login");--> statement-breakpoint
CREATE UNIQUE INDEX "escrows_bounty_id_uidx" ON "escrows" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "escrows_status_idx" ON "escrows" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "escrows_idempotency_key_uidx" ON "escrows" USING btree ("idempotency_key") WHERE "escrows"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_bounty_id_uidx" ON "fee_ledger" USING btree ("bounty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_links_user_id_uidx" ON "github_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_links_github_id_uidx" ON "github_links" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "github_links_github_login_idx" ON "github_links" USING btree ("github_login");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_github_repo_id_uidx" ON "repos" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX "repos_full_name_idx" ON "repos" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "repos_installation_id_idx" ON "repos" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "repos_connected_by_user_id_idx" ON "repos" USING btree ("connected_by_user_id");--> statement-breakpoint
CREATE INDEX "repos_is_active_idx" ON "repos" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uidx" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_wallet_address_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE OR REPLACE FUNCTION claim_locks_set_expires()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.locked_at + interval '72 hours';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER claim_locks_set_expires_trg
BEFORE INSERT ON claim_locks
FOR EACH ROW
EXECUTE FUNCTION claim_locks_set_expires();