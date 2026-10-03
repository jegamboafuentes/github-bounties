-- V6 PR1: provider column and empty HF tables. No behavior change.
-- Existing rows stay GitHub. Apply on DEV before remount. No env change.
-- pool_participants is unchanged (HF pool is later).

ALTER TABLE "repos" ADD COLUMN "provider" text DEFAULT 'github' NOT NULL;
--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_provider" CHECK ("provider" in ('github', 'huggingface'));
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "provider_repo_id" text;
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "hf_repo_type" text;
--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_hf_repo_type" CHECK (
	"hf_repo_type" IS NULL OR "hf_repo_type" in ('model', 'dataset', 'space')
);
--> statement-breakpoint
ALTER TABLE "repos" ALTER COLUMN "github_repo_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_github_requires_github_repo_id" CHECK (
	"provider" <> 'github' OR "github_repo_id" IS NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repos_provider_repo_id_uidx" ON "repos" ("provider", "provider_repo_id") WHERE "provider_repo_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "bounties" ADD COLUMN "provider" text DEFAULT 'github' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_provider" CHECK ("provider" in ('github', 'huggingface'));
--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_github_requires_issue_number" CHECK (
	"provider" <> 'github' OR "github_issue_number" IS NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bounties_provider_idx" ON "bounties" ("provider");
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "pr_author_provider_id" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "merged_by_login" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "merged_by_provider_id" text;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "provider" text DEFAULT 'github' NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_provider" CHECK ("provider" in ('github', 'huggingface'));
--> statement-breakpoint
CREATE TABLE "hf_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hf_sub" text NOT NULL,
	"hf_username" text NOT NULL,
	"hf_avatar_url" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hf_links" ADD CONSTRAINT "hf_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "hf_links_user_id_uidx" ON "hf_links" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hf_links_hf_sub_uidx" ON "hf_links" ("hf_sub");
--> statement-breakpoint
CREATE INDEX "hf_links_hf_username_idx" ON "hf_links" ("hf_username");
--> statement-breakpoint
CREATE TABLE "bounty_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_url" text NOT NULL,
	"pr_author_provider_id" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounty_submissions_provider" CHECK ("provider" in ('github', 'huggingface')),
	CONSTRAINT "bounty_submissions_pr_positive" CHECK ("pr_number" > 0),
	CONSTRAINT "bounty_submissions_pr_url_present" CHECK (length(trim("pr_url")) > 0),
	CONSTRAINT "bounty_submissions_status_present" CHECK (length(trim("status")) > 0)
);
--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_submissions_bounty_pr_uidx" ON "bounty_submissions" ("bounty_id", "pr_number");
--> statement-breakpoint
CREATE INDEX "bounty_submissions_bounty_id_idx" ON "bounty_submissions" ("bounty_id");
--> statement-breakpoint
CREATE INDEX "bounty_submissions_user_id_idx" ON "bounty_submissions" ("user_id");
