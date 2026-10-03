-- Single-use fee-withdraw confirm tokens, and one withdrawal row per token.
-- used_at is set before the send and stays set when the send fails.
-- pending/unknown block another withdraw from the same fee wallet.

CREATE TABLE "withdraw_confirm_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"destination" text NOT NULL,
	"network" text NOT NULL,
	"admin_email" text NOT NULL,
	"fee_address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdraw_confirm_tokens_hash_present" CHECK (length(trim("token_hash")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "withdraw_confirm_tokens_token_hash_uidx" ON "withdraw_confirm_tokens" ("token_hash");
--> statement-breakpoint
CREATE TABLE "fee_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"fee_address" text NOT NULL,
	"destination" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"network" text NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_withdrawals_token_fk" FOREIGN KEY ("token_id") REFERENCES "withdraw_confirm_tokens"("id") ON DELETE restrict,
	CONSTRAINT "fee_withdrawals_status" CHECK ("status" in ('pending', 'ok', 'failed', 'unknown')),
	CONSTRAINT "fee_withdrawals_idempotency_present" CHECK (length(trim("idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fee_withdrawals_token_id_uidx" ON "fee_withdrawals" ("token_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fee_withdrawals_idempotency_key_uidx" ON "fee_withdrawals" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "fee_withdrawals_one_inflight_per_wallet_uidx"
	ON "fee_withdrawals" ("fee_address")
	WHERE "status" in ('pending', 'unknown');
