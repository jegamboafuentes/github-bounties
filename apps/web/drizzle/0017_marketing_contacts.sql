-- Campaign contacts. One row per email, stored lowercase and trimmed.
-- Unsubscribes are one-way. Seed CSVs stay out of git.

CREATE TYPE "public"."marketing_contact_source" AS ENUM('ghb', 'lb1', 'both');
--> statement-breakpoint
CREATE TABLE "marketing_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"github_username" text,
	"user_id" uuid,
	"source" "marketing_contact_source" NOT NULL,
	"lb1_status" text,
	"contact_type" text,
	"subscribed" boolean DEFAULT true NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"resend_contact_id" text,
	"resend_synced_at" timestamp with time zone,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_contacts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "marketing_contacts_email_present" CHECK (length(btrim("email")) > 0),
	CONSTRAINT "marketing_contacts_email_normalized" CHECK ("email" = lower(btrim("email")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_email_uidx" ON "marketing_contacts" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "marketing_contacts_user_id_idx" ON "marketing_contacts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "marketing_contacts_source_idx" ON "marketing_contacts" USING btree ("source");
--> statement-breakpoint
CREATE INDEX "marketing_contacts_utm_campaign_idx" ON "marketing_contacts" USING btree ("utm_campaign");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_source" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_medium" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_campaign" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_content" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_term" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_landing_path" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attributed_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION marketing_contacts_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_contacts_normalize_email_trg
BEFORE INSERT OR UPDATE OF email ON marketing_contacts
FOR EACH ROW
EXECUTE FUNCTION marketing_contacts_normalize_email();
