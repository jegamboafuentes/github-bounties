# Public platform stats (`GET /api/stats`)

Reusable aggregates for the homepage and later surfaces. No session.

**Implementation:** [`getPlatformStats()`](../apps/web/src/stats/get-platform-stats.ts) (SQL over existing tables). Route: [`apps/web/src/app/api/stats/route.ts`](../apps/web/src/app/api/stats/route.ts).

After this lands on `main`, remount **DEV** (`github-bounties-web` / `https://dev.githubbounties.xyz`) so the route is live. This is **not** a PROD remount; production stays a new service per [prod-cutover.md](prod-cutover.md).

## Contract

`GET /api/stats` → `200` JSON, `cache-control: no-store`. No auth.

`schemaVersion` is `2`. Bump it when field names or bucket membership change. V3-0 replaced `repos.connected` (App installs) with `repos.withBounties` (repos that have had real platform work).

```json
{
  "ok": true,
  "schemaVersion": 2,
  "generatedAt": "2026-09-20T15:00:00.000Z",
  "product": "GitHub Bounties",
  "currency": "USDC",
  "buckets": {
    "open": ["pending_fund", "funded", "claim_locked"],
    "completed": ["settled", "settled_partial"],
    "closed": ["refunded", "cancelled", "expired", "void"],
    "inFlight": ["settling", "refunding"]
  },
  "bounties": {
    "total": 0,
    "open": 0,
    "completed": 0,
    "closed": 0,
    "inFlight": 0,
    "byStatus": {
      "pending_fund": 0,
      "funded": 0,
      "claim_locked": 0,
      "settling": 0,
      "settled": 0,
      "settled_partial": 0,
      "refunding": 0,
      "refunded": 0,
      "void": 0,
      "cancelled": 0,
      "expired": 0
    }
  },
  "volumeUsdc": {
    "transacted": "0.000000",
    "outstandingOpen": "0.000000",
    "outstandingInFlight": "0.000000",
    "completed": "0.000000"
  },
  "developers": {
    "participated": 0,
    "githubLinked": 0
  },
  "repos": {
    "withBounties": 0,
    "total": 0
  }
}
```

Empty database: every count is `0` and every USDC field is `"0.000000"`.

USDC fields are **strings** with 6 decimal places (schema `numeric(20, 6)`). Do not parse as IEEE floats for money math.

## Metric definitions

### Bounty buckets (`bounty_status`)

| Product bucket | Schema statuses | Notes |
| --- | --- | --- |
| `open` | `pending_fund`, `funded`, `claim_locked` | Product open / fundable. Schema has no `draft`; create writes `pending_fund`. Residual `claim_locked` is still an open hunt (V2-4 sunset). |
| `completed` | `settled`, `settled_partial` | Board: Completed (paid) / Winner paid — pool pending. |
| `closed` | `refunded`, `cancelled`, `expired`, `void` | Terminal unpaid / cancelled. |
| `inFlight` | `settling`, `refunding` | Money in motion; not product-open. |

`bounties.total` is the sum of `byStatus` (every enum value). Schema **active** (one-open-per-issue) also includes `settling` / `settled_partial` / `refunding`; that is **not** the product `open` count.

### USDC volume (face only, no fees)

`volumeUsdc.transacted` = `sum(escrows.amount_usdc)` where `escrows.status` ∈ `funded`, `settling`, `settled`, `settled_partial`, `refunding`, `refunded`.

That is the face F that reached a funded or settled **money event**. Refunded rows are included (they were funded first). **Not included:**

- `escrows.status` `pending` or `failed` (no lock)
- `fee_ledger.fee_usdc`
- `allocation_ledger` `FEE_OUT` (or any fee leg)

Each escrow is 1:1 with a bounty, so a bounty is counted once.

| Field | Definition |
| --- | --- |
| `outstandingOpen` | `sum(bounties.amount_usdc)` where status ∈ `funded`, `claim_locked` |
| `outstandingInFlight` | face on `settling`, `refunding`, `settled_partial` |
| `completed` | face on `settled` + `settled_partial` |

`pending_fund` face is advertised, not locked — it is not outstanding and not transacted.

### Developers

| Field | Definition |
| --- | --- |
| `participated` | Distinct hunters. GitHub id when known (`github_links` of claim / signal / lock / pool users, plus `pool_participants.github_id` for `winner` \| `pool` \| `overflow`). Unlinked hunters fall back to `users.id`. Poster-only users are excluded. `excluded_poster` / `excluded_bot` are excluded. |
| `githubLinked` | `count(*)` from `github_links` (connected GitHub identities, whether they hunted or not). |

### Repos

| Field | Definition |
| --- | --- |
| `withBounties` | Distinct `bounties.repo_id` — repos that have had **real platform work** (≥1 bounty row, any status). Does **not** count bare GitHub App installations. `repos.is_active` alone is the wrong metric. Inactive installs that still have bounty history **do** count. |
| `total` | All `repos` rows (install records, including unused). Not shown on the homepage. |

## Consumers

```ts
import { getPlatformStats } from "@/stats";
import { getRuntimeDb } from "@/db/runtime";

const stats = await getPlatformStats(getRuntimeDb());
```

Server components should call `getPlatformStats()` directly (same helper as the route). Browser clients: `fetch("/api/stats")`.

The homepage (`apps/web/src/app/page.tsx`) loads stats with `getPlatformStats()` and labels them per this file (`apps/web/src/home/stats-display.ts`).

Do not treat this payload as a fee dashboard or a pie-chart series — those are later tickets.

## Out of scope (this surface)

- Bounty pie charts (FE-2)
- Pool manual-Claim behavior
- Hosted checkout
- PROD remount of the DEV service
