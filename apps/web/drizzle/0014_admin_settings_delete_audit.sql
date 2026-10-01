-- V5 PR C: platform fee/pool settings, per-bounty fee stamp, soft delete, admin audit.
-- Additive. Existing bounties keep fee 200 and pool 1500.

CREATE TABLE "platform_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"fee_bps" integer DEFAULT 200 NOT NULL,
	"pool_bps" integer DEFAULT 1500 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "platform_settings_singleton" CHECK ("id" = true),
	CONSTRAINT "platform_settings_fee_bps_range" CHECK ("fee_bps" >= 0 AND "fee_bps" <= 1000),
	CONSTRAINT "platform_settings_pool_bps_range" CHECK ("pool_bps" >= 1000 AND "pool_bps" <= 2000)
);
--> statement-breakpoint
INSERT INTO "platform_settings" ("id", "fee_bps", "pool_bps") VALUES (true, 200, 1500);
--> statement-breakpoint
ALTER TABLE "bounties" ADD COLUMN "fee_bps" integer DEFAULT 200 NOT NULL;
--> statement-breakpoint
UPDATE "bounties" SET "fee_bps" = 200 WHERE "fee_bps" IS NULL;
--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_fee_bps_range" CHECK ("fee_bps" >= 0 AND "fee_bps" <= 1000);
--> statement-breakpoint
ALTER TABLE "bounties" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bounties" ADD COLUMN "deleted_by" text;
--> statement-breakpoint
-- Pool bps stays nullable for pre-V2 rows. Add the range only when every
-- stored value already sits in 1000–2000 (the column default is 1500).
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "bounties"
		WHERE "participation_pool_bps" IS NOT NULL
			AND ("participation_pool_bps" < 1000 OR "participation_pool_bps" > 2000)
	) THEN
		ALTER TABLE "bounties"
			ADD CONSTRAINT "bounties_pool_bps_range"
			CHECK (
				"participation_pool_bps" IS NULL
				OR ("participation_pool_bps" >= 1000 AND "participation_pool_bps" <= 2000)
			);
	END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "bounties_one_active_per_issue_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "bounties_one_active_per_issue_uidx"
	ON "bounties" ("repo_id", "github_issue_number")
	WHERE status in (
		'pending_fund',
		'funded',
		'claim_locked',
		'settling',
		'settled_partial',
		'refunding'
	) AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"network" text,
	"tx_hash" text,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log" ("created_at");
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_scopes";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_scopes" CHECK (
	cardinality("scopes") > 0
	AND "scopes" <@ ARRAY['read', 'write', 'money', 'admin']::text[]
);
