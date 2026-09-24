-- V4-2 API keys, request log (also the per-key rate-limit counter), spend ledger, and idempotency.
-- Hand-written. Drizzle snapshots stopped at 0006. Starts at 0011 because 0010 is reserved
-- for a parallel security migration. Every key belongs to a human users row.

CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"env" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"per_tx_cap_usdc" numeric(20, 6) NOT NULL,
	"daily_cap_usdc" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "api_keys_name_present" CHECK (length(trim("name")) > 0),
	CONSTRAINT "api_keys_env" CHECK ("env" in ('test', 'live')),
	CONSTRAINT "api_keys_prefix_present" CHECK (length(trim("prefix")) > 0),
	CONSTRAINT "api_keys_hash_present" CHECK (length(trim("key_hash")) > 0),
	CONSTRAINT "api_keys_scopes" CHECK (
		cardinality("scopes") > 0
		AND "scopes" <@ ARRAY['read', 'write', 'money']::text[]
	),
	CONSTRAINT "api_keys_per_tx_positive" CHECK ("per_tx_cap_usdc" > 0),
	CONSTRAINT "api_keys_daily_positive" CHECK ("daily_cap_usdc" > 0),
	CONSTRAINT "api_keys_daily_gte_tx" CHECK ("daily_cap_usdc" >= "per_tx_cap_usdc")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uidx" ON "api_keys" USING btree ("key_hash");
--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "api_keys_user_created_idx" ON "api_keys" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "api_request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"status" integer NOT NULL,
	"bounty_id" uuid,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_request_log_route_present" CHECK (length(trim("route")) > 0)
);
--> statement-breakpoint
ALTER TABLE "api_request_log" ADD CONSTRAINT "api_request_log_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_request_log" ADD CONSTRAINT "api_request_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "api_request_log_key_created_idx" ON "api_request_log" USING btree ("key_id", "created_at");
--> statement-breakpoint
CREATE INDEX "api_request_log_user_created_idx" ON "api_request_log" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "api_spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"bounty_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"tx_hash" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_spend_ledger_kind" CHECK ("kind" in ('fund', 'top_up')),
	CONSTRAINT "api_spend_ledger_status" CHECK ("status" in ('reserved', 'recorded', 'failed')),
	CONSTRAINT "api_spend_ledger_amount_positive" CHECK ("amount_usdc" > 0)
);
--> statement-breakpoint
ALTER TABLE "api_spend_ledger" ADD CONSTRAINT "api_spend_ledger_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_spend_ledger" ADD CONSTRAINT "api_spend_ledger_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "api_spend_ledger_key_created_idx" ON "api_spend_ledger" USING btree ("key_id", "created_at");
--> statement-breakpoint
CREATE INDEX "api_spend_ledger_bounty_idx" ON "api_spend_ledger" USING btree ("bounty_id");
--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"response_headers" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_keys_key_present" CHECK (length(trim("idempotency_key")) > 0),
	CONSTRAINT "api_idempotency_keys_hash_present" CHECK (length(trim("request_hash")) > 0)
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_keys_key_idem_uidx" ON "api_idempotency_keys" USING btree ("key_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_expires_idx" ON "api_idempotency_keys" USING btree ("expires_at");
