-- Poster edits of an unfunded bounty face. Additive only.
-- Allowed while nothing is funded; the service re-checks under a row lock.

CREATE TYPE "public"."bounty_amount_change_source" AS ENUM('web', 'rest', 'mcp');
--> statement-breakpoint
CREATE TABLE "bounty_amount_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"old_amount_usdc" numeric(20, 6) NOT NULL,
	"new_amount_usdc" numeric(20, 6) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"source" "bounty_amount_change_source" NOT NULL,
	"api_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounty_amount_changes_amounts_positive" CHECK ("old_amount_usdc" > 0 AND "new_amount_usdc" > 0),
	CONSTRAINT "bounty_amount_changes_amount_changed" CHECK ("old_amount_usdc" <> "new_amount_usdc")
);
--> statement-breakpoint
ALTER TABLE "bounty_amount_changes" ADD CONSTRAINT "bounty_amount_changes_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bounty_amount_changes" ADD CONSTRAINT "bounty_amount_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bounty_amount_changes" ADD CONSTRAINT "bounty_amount_changes_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bounty_amount_changes_bounty_id_idx" ON "bounty_amount_changes" USING btree ("bounty_id");
--> statement-breakpoint
CREATE INDEX "bounty_amount_changes_actor_user_id_idx" ON "bounty_amount_changes" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE INDEX "bounty_amount_changes_created_at_idx" ON "bounty_amount_changes" USING btree ("created_at");
