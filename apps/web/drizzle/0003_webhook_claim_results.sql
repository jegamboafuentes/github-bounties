ALTER TABLE "webhook_deliveries" ADD COLUMN "winner_login" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "pull_request_number" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "repository_full_name" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "claim_results" jsonb;
