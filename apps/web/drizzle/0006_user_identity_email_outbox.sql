CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status" CHECK ("email_outbox"."status" in ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "email_outbox_template" CHECK ("email_outbox"."template" in ('welcome', 'bounty_funded', 'pr_merged', 'bounty_settled', 'pool_claimable')),
	CONSTRAINT "email_outbox_to_email_present" CHECK (length(trim("email_outbox"."to_email")) > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "users" SET "last_seen_at" = COALESCE("updated_at", "created_at", now()) WHERE "last_seen_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_seen_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcome_enqueued_at" timestamp with time zone;--> statement-breakpoint
UPDATE "users" SET "welcome_enqueued_at" = "created_at" WHERE "welcome_enqueued_at" IS NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_idempotency_key_uidx" ON "email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_outbox_status_created_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_user_id_idx" ON "email_outbox" USING btree ("user_id");