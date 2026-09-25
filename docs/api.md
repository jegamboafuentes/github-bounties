# Public API and MCP

Anonymous reads (V4-1) need no API key. V4-2 adds Bearer API keys for `/me`, posting, work signals, unfunded cancel, and headless x402 fund / top-up. V4-3 adds winner claim, pool claim, payout status, and funded refund. Money over the API is DEV-only until `API_MONEY_ENABLED` is turned on for mainnet. The handlers call the same server functions as the website, so the 2% fee (`FEE_BPS` 200), the 15% pool (`POOL_BPS_OF_POST_FEE` 1500), and the retired claim-lock are unchanged.

V4-2 migration: `0011_api_access` (`api_keys`, `api_request_log`, `api_spend_ledger`, `api_idempotency_keys`). Apply it on DEV before creating keys. `0010` is reserved for a parallel security migration and is not part of this change.

| Surface | URL |
| --- | --- |
| DEV | `https://dev.githubbounties.xyz` |
| PROD | `https://githubbounties.xyz` |
| OpenAPI | `GET /api/v1/openapi.json` |
| Swagger UI | `GET /api/docs` |
| MCP | `POST /mcp` (streamable HTTP, stateless) |

Swagger UI is served from this app (`swagger-ui-dist` on the same origin). Its content security policy allows that bundle and Try it out against DEV and PROD. `servers[0]` in `GET /api/v1/openapi.json` is the public origin that served the document (`X-Forwarded-Host` or `Host` when that host is DEV or PROD). A missing or untrusted host uses `NEXT_PUBLIC_APP_URL`, then `APP_BASE_URL`, then `PUBLIC_BASE_URL`, then `AUTH_URL`. The other public origin is `servers[1]`, so Try it out hits the current environment and the other one stays selectable.

## Rate limit

About **60 requests per minute per client IP**, shared by `/api/v1` and `/mcp`. The counter is in memory on **each Cloud Run instance**. It is not a global limit. The client IP is the last address in `X-Forwarded-For`, which is the hop Cloud Run appends.

A limited call returns HTTP 429:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests from this IP. The limit is about 60 per minute on each Cloud Run instance.",
    "details": { "limitPerMinute": 60, "scope": "per_instance" }
  }
}
```

Headers: `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

Other `/api/v1` and MCP tool failures use the same envelope with `validation_failed`, `not_found`, `method_not_allowed`, `rate_limited`, or `internal`. Older `/api/*` routes keep `{ "ok": false, ... }`.

Bearer calls on `/api/v1` send the same `RateLimit-Limit` and `RateLimit-Reset` headers on 2xx and on 4xx (read 120/minute, write 20/minute, money 10/hour). A 401 also sends `WWW-Authenticate: Bearer`. Cookies are ignored. `/api/v1`, `/api/docs`, and `/mcp` skip the Auth.js middleware, so a bad session cookie is not decoded and responses do not set the Auth.js csrf-token or callback-url cookies.

`/api/v1` and `/mcp` send `Access-Control-Allow-Origin: *`. OPTIONS is a preflight (`Allow-Methods: GET, POST, DELETE, OPTIONS`, `Allow-Headers` includes `Authorization`, `Content-Type`, `Mcp-Session-Id`, `Idempotency-Key`, `PAYMENT-SIGNATURE`, and `X-PAYMENT`). Responses expose `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After`.

`POST`, `PUT`, `PATCH`, and `DELETE` on `/api/v1/*` return **405** with `Allow: GET, OPTIONS` (RFC 9110) and the same JSON error envelope (`method_not_allowed`).

## REST

`GET /api/v1/bounties` query parameters:

| Param | Meaning |
| --- | --- |
| `repo` | Case-insensitive substring of `owner/name` |
| `status` | A bounty status. Omit, or `all`, for every status |
| `complexity` | `S`, `M`, or `L` from the cached badge. Rows without a badge drop out |
| `language` | Substring of the cached language stack |
| `has_intel` | `true` or `false`. Ready cached badge only, or the rows without one |
| `sort` | `newest` (default) or `amount` (face USDC, descending) |
| `limit` | Default 20, maximum 100 |
| `cursor` | Opaque `nextCursor` from the previous page. Must use the same `sort` |

List rows include the issue, status, the face, the confirmed funded sum, the roster fee/pool schedule, cached badges, and the board funder stack (distinct count and up to five avatar URLs, newest contribution first). The list and the detail use one roster function. A funded bounty with no pool members has `payout.schedule` `roster`, `emptyPool` true, and the winner receives 100% of post-fee on both routes.

`amountUsdc` and `payout.faceUsdc` are the **face**: the posted amount, including top-ups after lock. The fee schedule uses the face. A bounty has a face as soon as it is created, before anyone sends USDC.

`totalFundedUsdc` is the **verified inflow**: the original escrow fund when `escrows.fund_tx_hash` is recorded, plus confirmed `bounty_contributions`, counting each fund transaction hash once. A Lock after crowdfunding writes that same hash on a contribution, and a top-up rewrites `escrows.amount_usdc` to the new face, so those amounts are not added twice. A bounty funded before crowdfunding has the hash and the face only on the escrow; that fund is the total. The field is `0.000000` when there is no verified inflow. It is not the face. The same rule is used by the list, the bounty detail, and the MCP tools `list_bounties` and `get_bounty`.

`status` says whether that sum is still locked:

| `status` | Meaning for `totalFundedUsdc` |
| --- | --- |
| `pending_fund` | Face is posted. No verified inflow, so the total is `0.000000`. |
| `funded`, `claim_locked` | Open and locked. The sum is the locked face, including top-ups. |
| `settling`, `settled`, `settled_partial` | Payout. The sum is what was confirmed. |
| `refunding` | A return is in progress. The sum is still the confirmed total, not the face and not a remaining balance. |
| `cancelled`, `expired` | Terminal. Either the draft was voided before lock (sum `0.000000`) or a locked bounty was refunded in full with no fee (sum is what was confirmed). |
| `refunded`, `void` | Terminal. The sum is not money still held. |

Poster cancel and expiry store bounty `status` as `cancelled` or `expired`. After a confirmed lock, detail `escrow.status` is `refunded` once the return finishes. `escrow.amountUsdc` is the escrow face record (top-ups rewrite it), not `totalFundedUsdc`.

`bounty.funders.avatars` (list and detail) and `GET /api/v1/bounties/{id}/funders` are both **newest first**. Avatars are distinct funders, capped at five, in the same order as the board avatar stack: the first face is the newest and is drawn on top. The funders route is one row per contribution, created time descending, then id descending. That matches the stack. The website's Funders section on the bounty page still lists oldest first; the API follows the avatar stack so the two API fields share one order. Neither payload includes a wallet address.

```bash
curl -sS 'https://dev.githubbounties.xyz/api/v1/bounties?repo=octo/hello&status=funded&complexity=M&limit=20'
curl -sS 'https://dev.githubbounties.xyz/api/v1/bounties/00000000-0000-4000-8000-000000000022'
curl -sS 'https://dev.githubbounties.xyz/api/v1/bounties/00000000-0000-4000-8000-000000000022/funders'
curl -sS 'https://dev.githubbounties.xyz/api/v1/bounties/00000000-0000-4000-8000-000000000022/intelligence'
curl -sS 'https://dev.githubbounties.xyz/api/v1/stats'
curl -sS 'https://dev.githubbounties.xyz/api/v1/openapi.json'
```

Open `https://dev.githubbounties.xyz/api/docs` for Swagger UI.

`GET /api/v1/bounties/{id}/intelligence` reads `bounty_intelligence` only. It does not call Gemini.

`GET /api/v1/bounties/{id}/funders` returns display name, GitHub login, avatar, amount, and time, newest contribution first. It does not return email, Google subject, or wallet address.

The detail route shows lock state as read-only. The exclusive claim-lock is retired. The issue body is the stored snapshot. The route does not refetch GitHub.

Detail `funding` lists confirmed fund and top-up transactions, oldest first, not only the original escrow fund hash. Each row has `kind` (`fund` or `top_up`), `amountUsdc`, `txHash`, `createdAt`, and `explorerUrl` (Base or Base Sepolia when the hash is a real `0x` transaction). Wallet addresses are omitted. The bounty page shows the same top-ups with explorer links.

## MCP

Tools, all read-only, call the same functions as the REST handlers:

- `list_bounties`
- `get_bounty`
- `list_funders` (newest contribution first, same order as `bounty.funders.avatars`)
- `get_bounty_intelligence`
- `get_stats`

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "github-bounties-dev": {
      "url": "https://dev.githubbounties.xyz/mcp"
    }
  }
}
```

Claude Code (anonymous reads):

```bash
claude mcp add --transport http github-bounties https://dev.githubbounties.xyz/mcp
```

## V4-2 keys, writes, and headless x402 (DEV)

Authorization is `Authorization: Bearer <key>` on `/api/v1` and `/mcp`. Cookies are ignored. `src/proxy.ts` does not session-gate those paths.

MCP lists 19 tools to anonymous callers. OpenAPI publishes 18 operations, each with its own `operationId`. Keyed tools stay in that list. Each one starts its description with `Requires API key (read scope)`, `Requires API key (write scope)`, or `Requires API key with money scope; DEV only`. Calling a keyed tool without a Bearer key returns `isError: true` and the `unauthorized` envelope (`error.code`, `error.message`, `error.details.scope`). The handler does not run.

Create a key on Settings → API keys. The plaintext is shown once. DEV keys start with `gb_test_`. Mainnet keys start with `gb_live_`. The server stores HMAC-SHA256 (`API_KEY_HMAC_SECRET`) plus a display prefix. Any signed-in user can create a key. The `money` scope stays disabled until that user has a saved payout wallet and a linked GitHub account. There are no agent-owned accounts.

Spend ceilings (a user can lower these, not raise them):

| Network | Per transaction | Per UTC day |
| --- | --- | --- |
| DEV (`base-sepolia`) | 50 USDC | 200 USDC |
| PROD (`base`) | 25 USDC | 100 USDC |

`API_PER_TX_CAP_USDC` and `API_DAILY_CAP_USDC` are optional admin overrides of those ceilings.

`API_MONEY_ENABLED` defaults **on** for `base-sepolia` and **off** for `CDP_NETWORK=base`. Set it to `0` to disable money on DEV. Do not set it on PROD until a later sign-off.

Authenticated limits, counted in `api_request_log` (shared across Cloud Run instances): read 120/minute, write 20/minute, money 10/hour. Anonymous reads stay at the V4-1 per-IP limit. `GET /api/v1/me`, `GET /api/v1/me/usage`, `GET /api/v1/me/bounties`, `GET /api/v1/me/claims`, and `GET /api/v1/bounties/{id}/claims` need the `read` scope. Post, work-signal, and unfunded cancel need `write`. Fund, top-up, claim, and refund need `money`.

`GET /api/v1/me/usage` returns this key's effective per-transaction cap, daily cap, USDC spent today (UTC day, reserved and recorded rows in `api_spend_ledger`), remaining today, and up to 50 recent ledger entries. Each entry has `amountUsdc`, `kind` (`fund` or `top_up`), `bountyId`, `txHash`, and `createdAt`. It never includes another user's rows. The MCP tool is `get_my_usage`.

`Idempotency-Key` is required on fund, top-up, cancel, claim, and refund. The same key and body replay the stored response. A different body returns `idempotency_conflict`. Fund and top-up: the first call returns **402** `payment_required` (amount is the face or the top-up amount, `payTo` is escrow, `approval_url` is the bounty page, `PAYMENT-REQUIRED` header). Retry with `PAYMENT-SIGNATURE` or `X-PAYMENT` and the same idempotency key. The server settles through the CDP facilitator and then calls `lockEscrowFunds` or `topUpFundedBounty`. The body cannot include an address or a pasted transaction hash. Caps are checked before the 402 and again before the spend is recorded.

Cancel is unfunded (`pending_fund`) only. Cancelling a bounty that is already `cancelled` returns **409** `already_cancelled` ("This bounty is already cancelled.") and does not move USDC. The same `Idempotency-Key` still replays the stored response. Funded cancel is `POST /api/v1/bounties/{id}/refund`. It calls `refundEscrow` and pays the recorded on-chain payer (the x402 sender stored on the escrow when that address is not the escrow wallet, otherwise the poster's saved wallet; a split refund uses each contribution's recorded funder). A caller-supplied address is rejected. The retired claim-lock, wallet changes, and GitHub disconnect are not exposed.

Refund and claim check the sum of every remaining unpaid leg before the first transfer. If verified inflow minus amounts already paid does not cover that sum, nothing moves and the response is **409** `insufficient_bounty_funds` with `verifiedAtomic`, `paidAtomic`, `requiredAtomic`, and a `legs` array (destination, amount, kind, status, tx hash, reason). A bounty already in `refunding` can be refunded again with a new `Idempotency-Key`: legs that already have a refund tx are skipped and only the remaining recorded payers are paid, then the bounty is `cancelled`. A 200 claim body keeps `destination`, `txHash`, and `amountUsdc`, and adds `legs` for every leg in that operation (`paid`, `failed`, or `pending`). A 200 refund keeps `amountUsdc` and `legs`. A single payer also keeps `destination` and `refundTxHash` for that one leg. A multi-payer refund sets both to null so they cannot pair one payer with another leg's hash; `legs` is the source of truth. The same pre-flight runs for website Claim, website cancel, pool claim, and the expiry cron, because they call `settleEscrow` and `refundEscrow`.

Winner claim is `POST /api/v1/bounties/{id}/claim` with `{ "kind": "winner" }`. Pool claim uses `{ "kind": "pool" }`. Both call `claimPayout` / `claimPoolPayout`, which call `settleEscrow` (`winner_and_fee` or `pool_member`). The payout address is the wallet saved on the key owner. The body cannot include an address, destination, `hunterUserId`, or any other user id. The key needs the `money` scope and a linked GitHub login that matches the winning PR author or that caller's own frozen pool row. Otherwise the response is 403 `not_winner` or `not_pool_member`. Authz runs before an idempotent replay. Settler checks inside `settleEscrow` (`not_settler`, facilitator, `payTo`) are unchanged.

`GET /api/v1/bounties/{id}/claims` is the caller's own legs on that bounty. `GET /api/v1/me/claims` is those legs across bounties. Both return status, amount, tx hash, and `destination` (the address paid, or the saved wallet that will be paid). They omit other hunters and the fee leg.

Error codes: `unauthorized`, `key_revoked`, `forbidden_scope`, `rate_limited`, `validation_failed`, `not_found`, `conflict`, `payment_required`, `spend_cap_exceeded`, `idempotency_key_required`, `idempotency_conflict`, `wallet_not_set`, `github_not_linked`, `already_cancelled`, `not_winner`, `not_pool_member`, plus bounty and escrow domain codes unchanged (`bounty_exists`, `not_poster`, `not_fundable`, `not_settler`, …).

```bash
curl -sS https://dev.githubbounties.xyz/api/v1/me \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS https://dev.githubbounties.xyz/api/v1/me/bounties \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS https://dev.githubbounties.xyz/api/v1/me/usage \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"issueUrl":"https://github.com/octo/hello/issues/42","amountUsdc":"5"}'
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/work-signal \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS -X DELETE https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/work-signal \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/cancel \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Idempotency-Key: cancel-1"
curl -sS -D - -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/fund \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Idempotency-Key: fund-1"
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/top-up \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: top-1" \
  -d '{"amountUsdc":"2"}'
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/claim \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: claim-winner-1" \
  -d '{"kind":"winner"}'
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/claim \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: claim-pool-1" \
  -d '{"kind":"pool"}'
curl -sS https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/claims \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS https://dev.githubbounties.xyz/api/v1/me/claims \
  -H "Authorization: Bearer $GB_API_KEY"
curl -sS -X POST https://dev.githubbounties.xyz/api/v1/bounties/$BOUNTY_ID/refund \
  -H "Authorization: Bearer $GB_API_KEY" \
  -H "Idempotency-Key: refund-1"
```

Cursor (`.cursor/mcp.json`), key from the environment:

```json
{
  "mcpServers": {
    "github-bounties-dev": {
      "url": "https://dev.githubbounties.xyz/mcp",
      "headers": {
        "Authorization": "Bearer ${env:GB_API_KEY}"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http github-bounties-dev https://dev.githubbounties.xyz/mcp \
  --header "Authorization: Bearer ${GB_API_KEY}"
```

Keyed MCP tools start with the scope they require. Money tools start with `Requires API key with money scope; DEV only`. Claim and refund tools are `claim_winner`, `claim_pool`, and `refund_bounty`. Their results include the same `legs` array as the REST 200 body. `refund_bounty` on a bounty already in `refunding` resumes the unpaid legs. An unknown tool argument is `validation_failed` on that tool's rate class (read 120/minute, write 20/minute, money 10/hour), not a generic JSON-RPC invalid-params error. Status tools are `get_bounty_claims` and `list_my_claims`. OpenAPI `info.version` and the MCP server version are both `4.3.0`.

An agent with a Base Sepolia CDP server wallet can post and fund a DEV bounty end to end with `apps/web/scripts/dev-agent-fund.ts` (not run in CI). After a winning merge, `apps/web/scripts/dev-agent-claim.ts` claims to the saved wallet or refunds a funded bounty to the recorded payer:

```bash
cd apps/web
GB_API_KEY=gb_test_... ISSUE_URL=https://github.com/octo/hello/issues/42 AMOUNT_USDC=5 \
  npx tsx scripts/dev-agent-fund.ts
GB_API_KEY=gb_test_... BOUNTY_ID=... KIND=winner \
  npx tsx scripts/dev-agent-claim.ts
```

### Env and secrets Ops must mount on DEV

| Name | Kind | Notes |
| --- | --- | --- |
| `API_KEY_HMAC_SECRET` | Secret Manager | Required before any key can be created or accepted. HMAC-SHA256 secret, at least 16 characters. Attach as `API_KEY_HMAC_SECRET=API_KEY_HMAC_SECRET:latest` when an enabled version exists (`WEB_OPTIONAL_SECRETS`, same skip-if-absent rule as `GEMINI_API_KEY`). |
| `API_MONEY_ENABLED` | Plain env, optional | Unset means on for `base-sepolia` and off for `base`. Set `0` to turn money off on DEV. Leave unset on PROD. |
| `API_PER_TX_CAP_USDC` | Plain env, optional | Admin ceiling. Default 50 on DEV, 25 on PROD. Users cannot raise their keys above this. |
| `API_DAILY_CAP_USDC` | Plain env, optional | Admin ceiling. Default 200 on DEV, 100 on PROD. |

Migration DEV needs: `0011_api_access`. V4-3 does not add a migration.
