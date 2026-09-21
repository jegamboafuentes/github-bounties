CREATE TABLE "bounty_intelligence" (
	"bounty_id" uuid PRIMARY KEY NOT NULL,
	"repo_about" text,
	"language_stack" text,
	"complexity" text,
	"model" text,
	"source_fingerprint" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"error_reason" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounty_intelligence_complexity_sml" CHECK ("bounty_intelligence"."complexity" is null or "bounty_intelligence"."complexity" in ('S', 'M', 'L')),
	CONSTRAINT "bounty_intelligence_status" CHECK ("bounty_intelligence"."status" in ('ready', 'error'))
);
--> statement-breakpoint
ALTER TABLE "bounties" ADD COLUMN "issue_body_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bounty_intelligence" ADD CONSTRAINT "bounty_intelligence_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bounty_intelligence_generated_at_idx" ON "bounty_intelligence" USING btree ("generated_at");