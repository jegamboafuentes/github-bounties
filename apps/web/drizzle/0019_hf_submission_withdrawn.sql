-- V6 PR6: withdraw keeps the row (status = withdrawn) so audits still see it.
-- Active uniqueness stays on status = submitted, so the same pull request can be submitted again.
-- Apply on DEV before remount.

DROP INDEX IF EXISTS "bounty_submissions_bounty_pr_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_submissions_bounty_pr_uidx" ON "bounty_submissions" ("bounty_id", "pr_number") WHERE "status" = 'submitted';
--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_status_enum" CHECK ("status" in ('submitted', 'withdrawn'));
