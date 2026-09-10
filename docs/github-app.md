# GitHub App setup (staging / test app)

Product users sign in with **Google Sign-In** ([docs/google-signin.md](google-signin.md)). This GitHub App is **repo authority + webhooks** (V1-3). Do not use GitHub user OAuth as product login. The App user-to-server OAuth flow only links `github_links` after a Google session.

Official name: **GitHub Bounties**. This is not Lightning Bounties / LB1 / “Lightning Bounties 2”.

Money path (CDP / x402 / 2% fee) is a separate V0-A ADR. Do not put USDC secrets in this App.

## Create a test App

1. GitHub → Settings → Developer settings → [GitHub Apps](https://github.com/settings/apps) → **New GitHub App**.
2. **GitHub App name:** `GitHub Bounties Staging` (must be unique on GitHub; 34 characters max).
3. **Homepage URL:** `https://github.com/jegamboafuentes/github-bounties` (until a product URL exists).
4. Fill the URLs below. **Webhook secret:** generate a high-entropy random string; store it as `GITHUB_WEBHOOK_SECRET` (Secret Manager later; `.env` locally). Never commit it.
5. **Permissions** and **Subscribe to events** as in the tables.
6. Check **Request user authorization (OAuth) during installation** so `/github/callback` receives a `code` to write `github_links`.
7. **Where can this GitHub App be installed?** For staging, **Only on this account** is fine.
8. Create the App. Record **App ID** and **slug**. Download the **private key** PEM once. The file is gitignored (`*.pem`). Store PEM contents as `GITHUB_APP_PRIVATE_KEY` (Secret Manager / env). Never commit it.
9. Install the App from the product **Settings → Connect GitHub** path (signed-in Google user). Prefer a private test repo.

Do not upload the PEM, webhook secret, client secret, or client ID to git.

## Staging URLs

Replace the origin with a reachable HTTPS host (`PUBLIC_BASE_URL`). Pathnames are fixed.

| GitHub App field | Staging value | When GitHub hits it |
| --- | --- | --- |
| **Webhook URL** | `{PUBLIC_BASE_URL}/webhooks/github` | Every subscribed event |
| **Setup URL** | `{PUBLIC_BASE_URL}/github/setup` | After install (and after install update if “Redirect on update” is checked) |
| **Callback URL** (user authorization) | `{PUBLIC_BASE_URL}/github/callback` | GitHub App user-to-server OAuth — **not** product login. Links `github_links` for a signed-in Google user. |
| **Webhook secret** | `GITHUB_WEBHOOK_SECRET` | HMAC for `X-Hub-Signature-256` |

Placeholder origin used in `.env.example`:

`https://github-bounties-staging.example.com`

Examples once you have a real host:

- `https://<host>/webhooks/github`
- `https://<host>/github/setup`
- `https://<host>/github/callback`

Local development: run `cd apps/web && npm run dev` (or the V0 stub `npm start` at repo root) and expose `/webhooks/github` with a tunnel ([smee.io](https://smee.io), Cloudflare Tunnel, ngrok). Point the App webhook URL at the tunnel. SSL verification should stay **on** for any real staging host.

GitHub sends `installation_id` on the setup redirect. **Do not trust it** as proof of install (GitHub documents that it can be spoofed). V1-3 confirms the installation with an App JWT (`GET /app/installations/{id}`) before writing `repos`.

`/github/setup` and `/github/callback` require a **Google session**. After GitHub redirects the browser (top-level GET, `SameSite=Lax` cookie is sent), an anonymous visitor is sent to `/signin` and then back with the query string intact.

## Minimal permissions

Request the least privilege that still supports merge→close detection and later labels/comments.

| Permission | Access | Why |
| --- | --- | --- |
| **Metadata** | Read-only | Mandatory on every GitHub App |
| **Issues** | Read & write | Read funded issues; later apply labels and post comments |
| **Pull requests** | Read-only | `pull_request` webhooks + PR body/title for closing keywords |
| **Contents** | Read-only | Fetch of the merge/squash commit message (keyword surface GitHub uses; **not** on the webhook payload) |

Do **not** request Administration, Checks, Actions, or Members for V1 eligibility.

## Subscribe to events

| Event | Why now | Later |
| --- | --- | --- |
| **Pull request** | Merge is truth. `action=closed` + `merged=true` is the eligibility signal | `opened` / `synchronize` can show work started while a lock is held |
| **Issues** | Optional context (labels). **Not** used as the eligibility signal (avoids double-fire with PR merge) | V1-4 best-effort `bounty-claimed` label + comment on lock |
| **Issue comment** | Not handled for eligibility | Claim comments (`/claim`) and expiry-job wakeups |
| **Installation** | Log install/uninstall; uninstall marks `repos.is_active=false` | Uninstall → pause claim-expiry jobs for that account |

Leave **webhooks Active**. Always set a webhook secret.

## After install: ping

Saving the webhook URL makes GitHub send a `X-GitHub-Event: ping` delivery. `apps/web` returns 200 after HMAC verify. Confirm signature verification in Recent deliveries (green) before merging a test PR.

## Secrets inventory (do not commit)

| Secret | Env | Used by |
| --- | --- | --- |
| Webhook secret | `GITHUB_WEBHOOK_SECRET` | HMAC on `POST /webhooks/github` (fail closed if unset) |
| App ID | `GITHUB_APP_ID` | App JWT + confirm installation |
| App slug | `GITHUB_APP_SLUG` | Install URL `https://github.com/apps/<slug>/installations/new` |
| App private key PEM | `GITHUB_APP_PRIVATE_KEY` | App JWT (install confirm, merge-commit / GraphQL fetch) |
| Client ID / client secret | `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | User-to-server OAuth to write `github_links` |

Empty placeholders only in `.env.example`. Secret Manager keys match the env names on `experiment-jegf` / `42206083192`. Ops sets versions out-of-band.

## Missing-secret blocker (no live App)

This environment (and CI) typically has:

- no `GITHUB_WEBHOOK_SECRET`
- no registered GitHub App
- no public HTTPS URL GitHub can POST to

Behavior when secrets are unset:

| Surface | Response |
| --- | --- |
| `POST /webhooks/github` | **503** `missing_github_webhook_secret` — fail closed, no unsigned accept |
| Settings → Connect GitHub | Documented missing-env list (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`) |
| `/github/setup`, `/github/callback` | Same missing-env list; no API calls |

Signature verification is proven with GitHub’s published HMAC test vector plus a signed `pull_request` fixture (see [webhooks.md](webhooks.md)). V0-B repo-root tests stay in CI (`npm test` at the repository root).

To clear the blocker on staging:

1. Create the test App and record id / slug / client / PEM / webhook secret in Secret Manager (never git).
2. Deploy or tunnel `apps/web` so `/webhooks/github` is HTTPS-reachable.
3. Set `GITHUB_WEBHOOK_SECRET` to the App webhook secret.
4. Sign in with Google, **Connect GitHub**, install on a repo with a funded bounty on `#N`.
5. Merge a PR whose body is `Fixes #<issue>` targeting the default branch.
6. Confirm one `claims` row with `status=eligible` and a redeliver of the same delivery GUID returns `duplicate: true`.
