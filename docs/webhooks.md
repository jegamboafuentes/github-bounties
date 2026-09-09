# Webhooks and claim eligibility

GitHub Bounties pays the **author of the merged pull request that closes funded issue `#N`**. Claim-lock (V1-4: exclusive **72 hours**) coordinates work; **merge is truth**. This webhook path does not move money and does not require an active lock — `funded` and `claim_locked` bounties both accept an eligible Claim. See [bounties.md](bounties.md).

Product login is Google Sign-In. This GitHub App is **repo authority + webhooks**.

## Two packages

| Package | Role |
| --- | --- |
| Repo-root `src/` + `tests/` (V0-B) | Spike stub. HMAC, in-memory/file delivery store, logs `would mark claim eligible`. **Kept green in CI** (`npm test` at repo root). |
| `apps/web` (V1-3) | Product path. Same predicate + fixtures. `POST /webhooks/github` writes `webhook_deliveries` and `claims` (`eligible`) when `#N` is a **funded** bounty. |

Implementation (product): [`apps/web/src/webhooks/`](../apps/web/src/webhooks/). Spike: [`src/verify-signature.ts`](../src/verify-signature.ts), [`src/eligibility.ts`](../src/eligibility.ts).

Staging webhook path: `https://<host>/webhooks/github`.

## Signature verification

GitHub signs every delivery with HMAC-SHA256 over the **raw body bytes** using the App webhook secret, and sends:

```
X-Hub-Signature-256: sha256=<hex>
```

The handler hashes the unparsed body and compares with `crypto.timingSafeEqual`. JSON is parsed only after a match. A mismatch is **401**.

If `GITHUB_WEBHOOK_SECRET` is unset, the product route returns **503** `missing_github_webhook_secret` (fail closed). See [github-app.md](github-app.md#missing-secret-blocker-no-live-app).

Do not use the legacy `X-Hub-Signature` (SHA-1) header.

Official test vector from [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries):

| Input | Value |
| --- | --- |
| secret | `It's a Secret to Everybody` |
| payload | `Hello, World!` |
| `X-Hub-Signature-256` | `sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17` |

That vector is checked in `tests/verify-signature.test.ts` and `apps/web/src/webhooks/verify-signature.test.ts`. It is a published example, not a production secret.

### Live GitHub delivery

**Blocked until a staging App and public HTTPS webhook URL exist.** No App credentials belong in git. Until staging exists, trust the unit tests + local signed replay.

## Idempotency / replay

Header `X-GitHub-Delivery` is a GUID for the delivery. [Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks) keeps the **same** GUID.

- **V0 stub:** records that id in memory, or `.data/deliveries.json` when `DELIVERY_STORE_PATH` is set.
- **V1-3:** unique row in `webhook_deliveries.delivery_id`.

A second POST with the same id:

- returns **200** with `duplicate: true` (so GitHub does not keep retrying)
- logs `[idempotency] skip duplicate delivery <guid>`
- does **not** emit a second eligibility write

V1 also unique on `(bounty_id, pr_number)` on `claims` so a later `issues.closed` handler cannot double-insert. This path **ignores** `issues` for eligibility for that reason.

## Eligibility predicate

A delivery **would mark a claim eligible** iff all of the following hold:

1. `X-GitHub-Event` is `pull_request`
2. `action` is `closed`
3. `pull_request.merged` is `true`
4. `pull_request.base.ref` equals the repository default branch (GitHub ignores closing keywords off default)
5. The PR closes at least one issue in **this** repository via any close surface:

| Surface | On the REST webhook? | Used |
| --- | --- | --- |
| PR **title** and **body** closing keywords | Yes | Yes |
| **Squash/merge commit message** | No — `GET` the commit (`Contents: Read`) when App JWT env exists | Fixtures inject `mergeCommitMessage` |
| Other **commit messages** on the PR | No | Fixtures inject `commitMessages` |
| Development sidebar / GraphQL `closingIssuesReferences` | No — fetch after merge when App JWT env exists | Fixtures inject `closingIssueNumbers` |

Closing keywords ([GitHub docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)):

`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`

Case-insensitive; optional colon. Same-repo: `Fixes #42`. Cross-repo: `Fixes owner/repo#42` (counted only if `owner/repo` is this repository). Issue URLs after a keyword also count.

**Not** closing keywords: `Refs`, `Related to`, `See`, `Duplicate of`.

**Winner** = `pull_request.user.login` (and `user.id` when present). V1-3 intersects `closedIssueNumbers` with **funded** (or `claim_locked`) bounties on a connected `repos` row and upserts `claims` with `status=eligible`.

The hunter must already have a `github_links` row (`github_id` or `github_login`). Otherwise the delivery is recorded and eligibility is logged as `hunter_not_linked` — `claims.hunter_user_id` is required.

Known GitHub behavior we reproduce: `must NOT close #N` still matches. Do not rely on negation in PR bodies.

### Squash-merge edge

GitHub’s default squash body is the PR title plus concatenated commit messages. A PR whose description was edited to `Refs #N` can still close `#N` if a commit said `Closes #N`. GitHub may also **keep** a sidebar link after the keyword is removed (`closingIssuesReferences` persists).

Webhook-only parsing of `body` is therefore **not** sufficient for V1. When `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` are set, `apps/web` fetches the merge commit + GraphQL links after `merged=true`. Fixtures cover the surfaces without a live App.

## Fixture table

Source of truth: [`fixtures/eligibility-cases.json`](../fixtures/eligibility-cases.json) (asserted by `tests/eligibility.test.ts` and `apps/web/src/webhooks/eligibility.test.ts`).

| id | Case | Eligible |
| --- | --- | --- |
| `fixes-hash` | Merged to default, body `Fixes #42` | true |
| `closes-hash` | Merged to default, body `Closes #42` | true |
| `resolves-colon-uppercase` | Body `RESOLVES: #42` | true |
| `fixes-in-sentence` | Body `This PR fixes #42.` | true |
| `same-repo-owner-prefix` | Body `Fixes octo/hello#42` | true |
| `issue-url` | Body `Fixes https://github.com/octo/hello/issues/42` | true |
| `multiple-issues` | `Resolves #10, closes #42` | true (issues 10 and 42) |
| `linked-issue-no-keyword` | Sidebar link `[42]`, body has no keyword | true |
| `squash-commit-closes` | Body `Refs #42`, squash message `Closes #42` | true |
| `commit-message-closes` | Empty body, commit `Closes #42` | true |
| `github-negation-false-positive` | Body `must NOT close #42` (GitHub still closes) | true |
| `refs-not-closing` | Body `Refs #42` only | false |
| `related-to` | Body `Related to #42` | false |
| `duplicate-of` | Body `Duplicate of #42` | false |
| `wrong-issue-number` | Body `Fixes #41` | true for #41 (V1 drops if #41 is not funded) |
| `cross-repo-ignored` | Body `Fixes other/repo#42` | false for this repo |
| `closed-not-merged` | Closed without merge, `Fixes #42` | false |
| `opened-not-closed` | `opened` + `Fixes #42` | false |
| `non-default-base` | Merged to `develop`, default is `main` | false |
| `issues-event-ignored` | `issues` / `closed` | false |
| `squash-body-only-refs-no-commit` | Squash, body `Refs #42`, no commit text, no links | false |
| `unfixed-not-keyword` | Body `still unfixed #42` | false |

## How to replay a delivery

### A. Local V0 stub (no GitHub account)

```bash
cp .env.example .env
# set any high-entropy GITHUB_WEBHOOK_SECRET
npm install
npm test
GITHUB_WEBHOOK_SECRET='test-secret' npm start
```

In another shell (same secret):

```bash
GITHUB_WEBHOOK_SECRET='test-secret' npm run replay -- fixtures/pull-request-merged-fixes.json --twice
```

First response: `duplicate: false`, `eligible: true`. Second: `duplicate: true`. Server log has exactly one `would mark claim eligible` line.

### B. Local `apps/web` (writes `claims` when the DB is seeded)

```bash
cd apps/web
# DATABASE_URL + GITHUB_WEBHOOK_SECRET in .env
npm run db:migrate
npm run test:unit
# with Postgres:
npm run test:db
```

Point `scripts/replay-delivery.ts` at `http://127.0.0.1:3000/webhooks/github` after `npm run dev`. Same delivery GUID must return `duplicate: true` and a single `claims` row.

### C. GitHub UI (real App, last 3 days)

1. GitHub → Settings → Developer settings → GitHub Apps → your staging App → **Advanced**.
2. Under **Recent deliveries**, open the delivery GUID.
3. **Redeliver**. `X-GitHub-Delivery` is unchanged; the worker must not write eligibility again.

### D. GitHub API

`POST /app/hook/deliveries/{delivery_id}/attempts` (authenticate as the App JWT). Same GUID semantics as the UI.

## Claim-lock (72h) — hooks only, not implemented

Do not build the lock state machine here (V1-4). Events that will matter later:

| Event | Hint for a future expiry job |
| --- | --- |
| `issue_comment` created | Hunter `/claim` timestamp; 72h window starts |
| `pull_request` opened / synchronize | Work underway during the lock |
| `issues` assigned | Alternate lock representation |
| `installation` deleted / `suspend` | Pause jobs; repo no longer authorized (`repos.is_active=false`) |
| `pull_request` closed + merged | Lock becomes irrelevant; eligibility (this ticket) fires |

Merge still pays the merged PR’s author even if the lock expired — product lock is coordination, not a second truth source.

## Out of scope

- Changing Google Sign-In (V1-2)
- Claim-lock UI / 72h board (V1-4)
- CDP / x402 / USDC / 2% fee ledger (V1-5)
- Agent / MCP
