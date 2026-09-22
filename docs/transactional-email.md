# Transactional email (V3.x foundation, DEV)

First successful Google sign-in records one `users` row (even with zero bounties) and enqueues a welcome email at most once. Sending is optional and **DEV-only**. This does not change manual pool Claim, escrow, or fee accounting.

Migration: [`apps/web/drizzle/0006_user_identity_email_outbox.sql`](../apps/web/drizzle/0006_user_identity_email_outbox.sql).

## Identity

Product login stays Google (`users.google_sub`). GitHub App OAuth still only writes `github_links`. There is no second user table.

| Column | Meaning |
| --- | --- |
| `users.google_sub` | Stable provider account id. Unique. Repeat login updates the same row. |
| `users.email` | Verified Google email. Required to sign in. Not a scraped GitHub address. |
| `users.display_name` | Google name, refreshed on login. |
| `users.avatar_url` | Google `picture` when it is an `http(s)` URL. Omitted pictures keep the stored value. GitHub avatars stay on `github_links.github_avatar_url`. |
| `users.created_at` | First successful sign-in. Not rewritten on later logins. |
| `users.last_seen_at` | Last successful sign-in. Wallet edits bump `updated_at` only. Existing rows are backfilled from `updated_at`. |

Sign-in path: Auth.js `jwt` callback → `upsertUserByGoogleSub`. If migrate `0006` is not applied yet (`42703` / `42P01`), sign-in falls back to the previous `google_sub` upsert and skips welcome so a revision without the migrate still lets people in.

## Outbox

Table `email_outbox`. Unique `idempotency_key`. Welcome key is `welcome:user:<users.id>`.

| Status | Meaning |
| --- | --- |
| `pending` | Ready to send |
| `sending` | Claimed by one worker (`FOR UPDATE SKIP LOCKED`) with a 2 minute lease |
| `sent` | Provider accepted. Not claimed again. |
| `failed` | Non-retryable, or 8 retryable transport attempts. `provider_auth` (401/403) stays pending so a fixed key can still drain the row. |

The dispatcher commits the claim before the HTTP call. Resend receives the same `Idempotency-Key` as the outbox key, so a crash after accept does not double-send. A second local dispatch of a `sent` row does not call the provider.

`to_email` is copied from `users.email` inside the sign-in transaction. If that Google email changes before send, a still-`pending` welcome row is updated to the new signed-up address. Sent rows are not rewritten. Blank or non-email values are not enqueued. The database check `email_outbox_to_email_present` rejects a stored recipient without `@`.

Recipients are never loaded from the GitHub API, including private `users.noreply.github.com` addresses that are not the Google account email on `users`.

Templates allowed by the check (only `welcome` is enqueued here): `welcome`, `bounty_funded`, `bounty_merged`, `bounty_settled`, `pool_claimable`. The other four are render functions only. They do not run on fund, merge, settle, or pool Claim.

There is no cron in this slice. After commit, sign-in calls `dispatchEmailOutbox` for **that user** only. `dispatchEmailOutbox()` without `userId` can drain a pending batch later. Rows stay `pending` until a configured dispatch runs.

Users created before this code do not get a backfilled welcome on their next login.

## Provider

[Resend](https://resend.com) HTTPS `POST https://api.resend.com/emails`. No SMTP. The adapter is behind `TransactionalEmailProvider`. The API key is read from `process.env.RESEND_API_KEY` on the server. `NEXT_PUBLIC_RESEND_API_KEY` is ignored.

| Name | Kind | Required to send | Where |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Secret Manager secret | yes | Server env only. Optional on DEV. |
| `RESEND_FROM` | Plain env, not a secret | yes | Example shape: `GitHub Bounties <notifications@dev.githubbounties.xyz>` |

If either is missing, dispatch returns without throwing and **does not claim rows**. Sign-in still saves the user and leaves the welcome `pending`. `GET /api/health` → `email.configured` is `true` only when both are set (boolean only; the key is never returned).

Ops must verify the From domain in Resend before real delivery. Do not put the API key in git, client bundles, or `NEXT_PUBLIC_*`.

Links and the logo use `PUBLIC_BASE_URL`, then `AUTH_URL`, then `https://dev.githubbounties.xyz`. The logo is the existing asset `/brand/logo-1.png`. Unset origins do not default to the production apex.

## DEV deploy (no PROD)

Apply `0006_user_identity_email_outbox` on the **DEV** Cloud SQL instance (`github-bounties-staging`) in the same remount as the web revision. Same helpers as [staging-deploy.md](staging-deploy.md): `./infra/gcloud/migrate-staging.sh` (dry-run, then `--apply` by Ops). Do not run this from a Cloud Agent.

`RESEND_API_KEY` is a `WEB_OPTIONAL_SECRET` in [`infra/gcloud/config.sh`](../infra/gcloud/config.sh), same pattern as `GEMINI_API_KEY`:

- Create the Secret Manager **resource** and add a version from stdin. Never commit the value.
- `deploy-web.sh` attaches `RESEND_API_KEY=RESEND_API_KEY:latest` only when an enabled version exists.
- Do **not** add it to the required first-deploy `--set-secrets` list. A named secret with 0 versions fails the deploy.
- Set plain env `RESEND_FROM` on the DEV service when you want delivery. Leave it unset to keep mail queued.
- **Do not bind `RESEND_API_KEY` on `github-bounties-web-prod`.** Dispatch also refuses the prod service name, `APP_ENV=prod`, and `AUTH_URL` / `PUBLIC_BASE_URL` on `githubbounties.xyz`.

This PR does not deploy.

## Product notes

- Google remains the only product login. A Google account with a missing or unverified email still cannot sign in, and no welcome is queued.
- Welcome copy is rendered once, at first insert. A later display-name change does not rewrite a pending body. The pending recipient email does follow `users.email`.
- Pool Claim, winner Claim, and settlement math are untouched. The pool-claimable template is not wired.
