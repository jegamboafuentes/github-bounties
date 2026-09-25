# Transactional email (V3.x A1–A2)

DEV only. Sign-in still upserts the existing `users` row by Google `google_sub`. There is no second user table. PROD is not wired: do not mount `RESEND_API_KEY` on `github-bounties-web-prod`, and do not treat this as a PROD remount.

A1 built identity columns, the outbox, the Resend adapter, welcome-once, and render primitives. A2 enqueues `bounty_funded`, `pr_merged`, `bounty_settled`, and `pool_claimable` from the existing fund-lock, winning-merge, and winner-settlement writes. Manual pool Claim and payout math are unchanged. This does not start an About page, a homepage story, or crowdfunding.

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

| Template | When it enqueues | Recipient | Idempotency key |
| --- | --- | --- | --- |
| `welcome` | First successful signup (not backfilled) | That new user | `welcome:<user id>` |
| `bounty_funded` | After fund lock commits `bounties.status = funded` | Poster (funder) only | `bounty_funded:<bounty id>` |
| `pr_merged` | When `markEligibleClaims` writes the claim as `eligible` | Winning developer | `pr_merged:<claim id>` |
| `bounty_settled` | After the winner wallet leg has `escrows.payout_tx_hash` | Winning developer | `bounty_settled:<claim id>` |
| `pool_claimable` | When that winner payout hash exists and a frozen pool share is still unpaid | Each non-winning pool participant with `user_id` | `pool_claimable:<bounty id>:<participant id>` |

Copy names the bounty (title, `owner/repo`, issue number, link) and the relevant amount. `bounty_settled` states the net amount paid to the winner wallet. `pool_claimable` states that they did not win the main reward, the earned pool amount, and a Claim link. The email does not submit the Claim.

Delivery is attempted inline for that user after enqueue (`deliverOutbox`). There is still no Cloud Scheduler sweeper. A row left `pending` because `RESEND_API_KEY` is missing is sent on a later sign-in for that user, or on a later idempotent re-entry of the same hook. Missing key, blank mail, noreply mail, and provider errors do not fail sign-in, funding, webhook eligibility, or Claim.

## Hook points

| Event | Function | Why this moment |
| --- | --- | --- |
| `bounty_funded` | `lockEscrowFunds` after the funded transaction commits, and again if Lock is repeated while status is still `funded` | x402 `402` and a pending inbound record do not lock. The bounty stays `pending_fund` until this commit. |
| `pr_merged` | `markEligibleClaims` after an insert or update that leaves the claim `eligible` | That is the same write that makes the winner Claim-eligible, including the Connect GitHub backfill. |
| `bounty_settled` and `pool_claimable` | `settleEscrow` after a successful return (`notifyAfterWinnerPayout`) | Winner Claim (`scope=winner_and_fee`) and the settle API both land here. Pool shares become claimable once the winner payout hash exists. |
| `pool_claimable` late link | `backfillUnlinkedPoolParticipants` | Connect GitHub can stamp `user_id` after the share is already claimable. The same idempotency key prevents a second send. |

`claimPoolPayout` still calls `settleEscrow` for that one participant. It does not pay anyone else and does not change share amounts. A repeat only re-enters the outbox.

## Provider

[Resend](https://resend.com) over HTTPS from the server (`POST https://api.resend.com/emails`). No SDK. The key is read from `process.env.RESEND_API_KEY` only — never `NEXT_PUBLIC_*`. If the key is unset, send is skipped and sign-in, funding, and Claim continue. `GET /api/health` exposes `email.configured` as a boolean only.

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
- There is no background worker. Pending mail for a user is attempted on their next sign-in and when a domain hook for that user runs again.
- Recipients are `users.email` only. Private GitHub emails are never read. Blank and `*@users.noreply.github.com` / `*@noreply.github.com` addresses are skipped and the money or claim write still succeeds.
- `user_notification_preferences` (migration `0012_profile_notification_prefs`) stores four flags: `bounty_funded`, `pr_merged`, `bounty_settled`, `pool_claimable`. No row means all four stay on. `welcome` is not a flag and still sends once. Enqueue skips a disabled template (`preference_disabled`) and does not insert. Deliver marks an already queued row `failed` with `last_error` `notification_preference_disabled` and does not call Resend. Settings shows the same toggles on DEV and PROD. Delivery stays DEV-only.
- Pool Claim stays manual and per participant. These emails do not move USDC.

### Not invented

- **No mail before lock.** A payment challenge or a recorded inbound with `pending_fund` does not enqueue `bounty_funded`. After the bounty leaves `funded` (claim lock, settling, settled), a missed funder enqueue is not retried. A repeated Lock while status is still `funded` retries the enqueue and still returns `not_fundable`.
- **Winner mail follows the winner wallet leg.** `bounty_settled` enqueue needs `escrows.payout_tx_hash`. The amount is `claims.payout_usdc` when settlement stamped it, otherwise the `WINNER_PAYOUT` ledger amount. A settle call with no `claims` row has no signed-up winner to email.
- **Pool mail is not a payout.** It goes only to frozen `role = pool` rows with a positive `share_usdc`, no `payout_tx_hash`, and a `user_id`. Overflow, excluded, and winner-role rows are not recipients. A `user_id` that is still null at that moment is skipped until Connect GitHub backfill, and only if the share is still unpaid. `scope=all` that pays pool legs in the same settle does not email shares that already have a payout hash.
- **No second money path.** Fee, winner, and pool amounts stay on the existing split. Claim still requires the participant’s own wallet.
