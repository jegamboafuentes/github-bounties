-- V6 PR5: snapshot the Hugging Face username on a submission.
-- One active (status = submitted) row per user per bounty.
-- 0017 is reserved by the marketing-contacts PR. Apply on DEV before remount.

ALTER TABLE "bounty_submissions" ADD COLUMN "hf_author" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_submissions_active_user_uidx" ON "bounty_submissions" ("bounty_id", "user_id") WHERE "status" = 'submitted';
