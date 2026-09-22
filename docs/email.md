# Transactional email (V3.x A1)

DEV foundation. Sign-in still upserts the existing `users` row by Google `google_sub`. There is no second user table. PROD is not wired: do not mount `RESEND_API_KEY` on `github-bounties-web-prod`, and do not treat this as a PROD remount.

Manual pool Claim is unchanged. This PR does not subscribe fund, merge, settle, or pool-claim events, and it does not move USDC.

## Identity

Migration `0006_user_identity_email_outbox` adds, on `users`:

| Column | Meaning |
| --- | --- |
| `avatar_url` | Google profile picture when it is `https`. Repeat login keeps the previous value when the new profile has no https picture. |
| `last_seen_at` | Set on every successful sign-in. Existing rows are backfilled from `updated_at` (else `created_at`). |
| `welcome_enqueued_at` | Set when the one welcome outbox row is inserted, or when the address is a permanent skip (GitHub noreply). |

`created_at` stays the first successful sign-in. Repeat login updates email, display name, avatar (when present), and `last_seen_at` on the same row. Unique `users.google_sub` is what prevents duplicates.

Rows that already existed when `0006` runs get `welcome_enqueued_at = created_at`. They are not sent a retroactive welcome. A brand-new signup leaves the column null until enqueue finishes. If that enqueue fails, the next login retries it. Sign-in still succeeds when email enqueue or delivery throws.

## Outbox

Table `email_outbox`. One row per `idempotency_key` (welcome key is `welcome:<user id>`).

| Status | Meaning |
| --- | --- |
| `pending` | Waiting. Missing `RESEND_API_KEY` leaves the row here. |
| `sending` | Claimed by one worker (`FOR UPDATE SKIP LOCKED`). |
| `sent` | Provider accepted it. Never claimed again. |
| `failed` | Terminal (attempt cap, missing signup mailbox, rejected recipient). |

Claim lease is 5 minutes. A crashed worker’s `sending` row can be reclaimed after that. The provider call sends the same idempotency key (`Idempotency-Key`) so a reclaim inside the provider’s window does not double-send. `markSent` updates only the worker that still owns the row.

Recipients are `users.email` from the Google signup. The enqueue API has no `to` argument. Blank mailboxes are skipped. `*@users.noreply.github.com` and `*@noreply.github.com` are rejected. Private GitHub emails are never read.

## Templates

Server-rendered HTML (responsive, max-width 560px, wordmark at `/logo-wordmark.png`) plus plain text.

| Template | Wired in this PR |
| --- | --- |
| `welcome` | Yes — once, after the first successful signup (not backfilled) |
| `bounty_funded` | Primitive only |
| `pr_merged` | Primitive only |
| `bounty_settled` | Primitive only |
| `pool_claimable` | Primitive only. Copy says manual pool Claim is unchanged |

Delivery runs on that user’s sign-in (their pending rows only). There is no Cloud Scheduler sweeper in this PR. Later events can call `enqueueEmailForUser` and `deliverOutbox` when those domain writes exist.

## Provider

[Resend](https://resend.com) over HTTPS from the server (`POST https://api.resend.com/emails`). No SDK. The key is read from `process.env.RESEND_API_KEY` only — never `NEXT_PUBLIC_*`. If the key is unset, send is skipped and sign-in continues. `GET /api/health` exposes `email.configured` as a boolean only.

## DEV secrets (names only)

Apply migrate `0006` on the **DEV** database in the same remount as the web revision. Do not run it against PROD for this change.

| Name | Kind | Required |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret Manager, server-only | No. `WEB_OPTIONAL_SECRETS`. Attach `RESEND_API_KEY=RESEND_API_KEY:latest` when an enabled version exists. Skip when it does not. A named secret with 0 versions must not be put on the required `--set-secrets` list. |
| `EMAIL_FROM` | Plain env, not a secret | No. Default `GitHub Bounties <noreply@githubbounties.xyz>`. The domain must be verified in Resend or delivery fails and the outbox retries. DEV can set a Resend-verified sender instead. |
| `PUBLIC_BASE_URL` or `AUTH_URL` | Plain env / existing SM | No new secret. Logo and links use this origin, else `https://dev.githubbounties.xyz`. |

Create the secret and add a version from stdin (never git, never echo the value):

```bash
gcloud secrets create RESEND_API_KEY \
  --replication-policy=automatic \
  --labels=product=github-bounties,env=staging \
  --project=experiment-jegf

gcloud secrets versions add RESEND_API_KEY --data-file=- --project=experiment-jegf
```

Then remount DEV with `./infra/gcloud/deploy-web.sh` so the optional secret attaches. **PROD is not wired.**

## Product notes

- Welcome is not backfilled to accounts that existed before `0006`.
- There is no background worker. A welcome left `pending` because the secret was missing is sent on a later sign-in for that user.
- `bounty_funded`, `pr_merged`, `bounty_settled`, and `pool_claimable` do not fire from escrow, webhooks, or Claim.
- Pool Claim semantics and accounting are untouched.
