# Public API and MCP (V4-1)

Read-only HTTP API and MCP tools for the public bounty board. No API key. No writes, no funding, no claims. The handlers call the same server functions as the website, so the 2% fee, the 15% pool, and the retired claim-lock are unchanged.

No database migration.

| Surface | URL |
| --- | --- |
| DEV | `https://dev.githubbounties.xyz` |
| PROD | `https://githubbounties.xyz` |
| OpenAPI | `GET /api/v1/openapi.json` |
| Swagger UI | `GET /api/docs` |
| MCP | `POST /mcp` (streamable HTTP, stateless) |

Swagger UI is served from this app (`swagger-ui-dist` on the same origin). Its content security policy allows that bundle and Try it out against DEV and PROD.

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

`GET /api/v1` sends `Access-Control-Allow-Origin: *` for GET and OPTIONS.

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

List rows include the issue, status, the face, the confirmed funded sum, the empty-pool fee/pool schedule, cached badges, and the board funder stack (distinct count and up to five avatar URLs, newest contribution first). The live roster split is on the detail route.

`amountUsdc` and `payout.faceUsdc` are the **face**: the posted amount, including top-ups after lock. The fee schedule uses the face. A bounty has a face as soon as it is created, before anyone sends USDC.

`totalFundedUsdc` is the **sum of confirmed contributions**: `bounty_contributions` rows that have a recorded fund transaction. It is `0.000000` when there are none. It is not the face. The same rule is used by the list, the bounty detail, and the MCP tools `list_bounties` and `get_bounty`.

`status` says whether that sum is still locked:

| `status` | Meaning for `totalFundedUsdc` |
| --- | --- |
| `pending_fund` | Face is posted. Nothing is confirmed, so the sum is `0.000000`. |
| `funded`, `claim_locked` | Open and locked. The sum is the locked face, including top-ups. |
| `settling`, `settled`, `settled_partial` | Payout. The sum is what was confirmed. |
| `refunding` | A return is in progress. The sum is still the confirmed total, not the face and not a remaining balance. |
| `cancelled`, `expired` | Terminal. Either the draft was voided before lock (sum `0.000000`) or a locked bounty was refunded in full with no fee (sum is what was confirmed). |
| `refunded`, `void` | Terminal. The sum is not money still held. |

Poster cancel and expiry store bounty `status` as `cancelled` or `expired`. After a confirmed lock, detail `escrow.status` is `refunded` once the return finishes. `escrow.amountUsdc` is the escrow face record, not `totalFundedUsdc`.

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

Claude Code:

```bash
claude mcp add --transport http github-bounties https://dev.githubbounties.xyz/mcp
```

No `Authorization` header in V4-1. API keys arrive in V4-2.
