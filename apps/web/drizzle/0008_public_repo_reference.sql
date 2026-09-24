CREATE TYPE "public"."repo_connection_kind" AS ENUM('app_install', 'public_reference');--> statement-breakpoint
ALTER TABLE "repos" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "connection_kind" "repo_connection_kind" DEFAULT 'app_install' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_app_install_requires_installation" CHECK ("connection_kind" <> 'app_install' OR "installation_id" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "repos_connection_kind_idx" ON "repos" USING btree ("connection_kind");
