-- V4-4 display-name lock and email notification preferences.
-- Additive. A missing preference row means every bounty email stays enabled.
-- Welcome is not a column. Wallet changes stay on the session Settings page.

ALTER TABLE "users" ADD COLUMN "display_name_custom" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_bounty_funded" boolean DEFAULT true NOT NULL,
	"email_pr_merged" boolean DEFAULT true NOT NULL,
	"email_bounty_settled" boolean DEFAULT true NOT NULL,
	"email_pool_claimable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
