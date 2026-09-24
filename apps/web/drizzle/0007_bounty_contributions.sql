CREATE TABLE "bounty_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"funder_user_id" uuid NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"fund_tx_hash" text NOT NULL,
	"funder_address" text,
	"refund_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounty_contributions_amount_positive" CHECK ("amount_usdc" > 0)
);
--> statement-breakpoint
ALTER TABLE "bounty_contributions" ADD CONSTRAINT "bounty_contributions_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_contributions" ADD CONSTRAINT "bounty_contributions_funder_user_id_users_id_fk" FOREIGN KEY ("funder_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_contributions_bounty_tx_uidx" ON "bounty_contributions" USING btree ("bounty_id","fund_tx_hash");--> statement-breakpoint
CREATE INDEX "bounty_contributions_bounty_id_idx" ON "bounty_contributions" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX "bounty_contributions_funder_user_id_idx" ON "bounty_contributions" USING btree ("funder_user_id");
