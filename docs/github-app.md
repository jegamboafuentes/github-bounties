# GitHub App setup (staging / test app)

This spike uses a **GitHub App** for repository authority (install + webhooks). Product users will sign in with **Google Sign-In later**. Do not implement GitHub user OAuth in V0-B beyond registering the callback URL so the App form is complete.

Official name: **GitHub Bounties**. This is not Lightning Bounties / LB1 / “Lightning Bounties 2”.

Money path (CDP / x402 / 2% fee) is a separate V0-A ADR. Do not put USDC secrets in this App.

## Create a test App

1. GitHub → Settings → Developer settings → [GitHub Apps](https://github.com/settings/apps) → **New GitHub App**.
2. **GitHub App name:** `GitHub Bounties Staging` (must be unique on GitHub; 34 characters max).
3. **Homepage URL:** `https://github.com/jegamboafuentes/github-bounties` (until a product URL exists).
4. Fill the URLs below. **Webhook secret:** generate a high-entropy random string; store it as `GITHUB_WEBHOOK_SECRET` (Secret Manager later; `.env` locally). Never commit it.
5. **Permissions** and **Subscribe to events** as in the tables.
6. **Where can this GitHub App be installed?** For the spike, **Only on this account**.
7. Create the App. Record **App ID**. Download the **private key** PEM once. The file is gitignored (`*.pem`). This spike does not call the GitHub API, so the PEM is unused until V1 fetches merge commits / `closingIssuesReferences`.
8. Install the App on a throwaway repo you own. Prefer a private test repo.

Do not upload the PEM, webhook secret, client secret, or client ID to git.

## Staging URLs

Replace the origin with a reachable HTTPS host (`PUBLIC_BASE_URL`). Pathnames are fixed by this repo’s stub.

| GitHub App field | Staging value | When GitHub hits it |
| --- | --- | --- |
| **Webhook URL** | `{PUBLIC_BASE_URL}/webhooks/github` | Every subscribed event |
| **Setup URL** | `{PUBLIC_BASE_URL}/github/setup` | After install (and after install update if “Redirect on update” is checked) |
| **Callback URL** (user authorization) | `{PUBLIC_BASE_URL}/github/callback` | GitHub App OAuth — **unused** for product login (Google later). Register it so the App form is valid. |
| **Webhook secret** | `GITHUB_WEBHOOK_SECRET` | HMAC for `X-Hub-Signature-256` |

Placeholder origin used in `.env.example`:

`https://github-bounties-staging.example.com`

Examples once you have a real host:

```
https://<staging-host>/webhooks/github
https://<staging-host>/github/setup
https://<staging-host>/github/callback
```

Local development: run `npm start` and expose `/webhooks/github` with a tunnel ([smee.io](https://smee.io), Cloudflare Tunnel, ngrok). Point the App webhook URL at the tunnel. SSL verification should stay **on** for any real staging host.

GitHub sends `installation_id` on the setup redirect. **Do not trust it** as proof of install (GitHub documents that it can be spoofed). V1 should confirm the installation with a user-to-server token. This stub only logs the query param.

## Minimal permissions

Request the least privilege that still supports merge→close detection and later labels/comments.

| Permission | Access | Why |
| --- | --- | --- |
| **Metadata** | Read-only | Mandatory on every GitHub App |
| **Issues** | Read & write | Read funded issues; later apply labels and post comments (not in this spike) |
| **Pull requests** | Read-only | `pull_request` webhooks + PR body/title for closing keywords |
| **Contents** | Read-only | V1 fetch of the merge/squash commit message (keyword surface GitHub uses; **not** on the webhook payload) |

Do **not** request Administration, Checks, Actions, or Members for V1 eligibility.

## Subscribe to events

| Event | Why now | Later (72h claim-lock job — **not implemented**) |
| --- | --- | --- |
| **Pull request** | Merge is truth. `action=closed` + `merged=true` is the eligibility signal | `opened` / `synchronize` can show work started while a lock is held |
| **Issues** | Optional context (labels). **Not** used as the eligibility signal (avoids double-fire with PR merge) | `assigned` / `unassigned` if lock is modeled as assignment |
| **Issue comment** | Not handled for eligibility | Claim comments (`/claim`) and expiry-job wakeups |
| **Installation** | Log install/uninstall | Uninstall → pause claim-expiry jobs for that account |

Leave **webhooks Active**. Always set a webhook secret.

## After install: ping

Saving the webhook URL makes GitHub send a `X-GitHub-Event: ping` delivery. The stub returns 200. Confirm signature verification in Recent deliveries (green) before merging a test PR.

## Secrets inventory (do not commit)

| Secret | Env | Used in this spike |
| --- | --- | --- |
| Webhook secret | `GITHUB_WEBHOOK_SECRET` | Yes (HMAC) |
| App ID | `GITHUB_APP_ID` | No (document only) |
| App private key PEM | `GITHUB_APP_PRIVATE_KEY_PATH` | No |
| Client ID / client secret | — | No (GitHub OAuth unused) |

## Live delivery blocker (this environment)

This Cloud Agent VM has:

- no `GITHUB_WEBHOOK_SECRET`
- no registered GitHub App
- no public HTTPS URL GitHub can POST to

So a **real GitHub delivery was not received here**. Signature verification is proven with GitHub’s published HMAC test vector plus a signed `pull_request` fixture posted to the local stub (see [webhooks.md](webhooks.md)).

To clear the blocker on staging:

1. Create the test App and install it on a repo.
2. Deploy or tunnel this stub so `/webhooks/github` is HTTPS-reachable.
3. Set `GITHUB_WEBHOOK_SECRET` to the App webhook secret.
4. Merge a PR whose body is `Fixes #<issue>` targeting default branch.
5. Confirm one log line `would mark claim eligible` and a redeliver of the same delivery GUID logs `skip duplicate delivery`.
