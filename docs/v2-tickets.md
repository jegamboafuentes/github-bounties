# V2 multi-hunter pool — eng tickets / spike plan

- **ADR:** [0003 — V2 multi-hunter participation pool](adr/0003-v2-multi-hunter-pool.md) (**Proposed**)
- **Product rules:** frozen by LB PM (Enrique delegated). Tickets must match the freeze exactly.
- **This PR:** plan and docs only. **Do not implement V2 here.**
- **Not blocking:** V1.5 WalletConnect + amount chips is parallel polish after x402
  [#29](https://github.com/jegamboafuentes/github-bounties/pull/29). It does not
  gate this spec or V2-0…V2-5.

Official name: **GitHub Bounties**. This is not Lightning Bounties / LB1.

V1 today: single winner (merged PR author), 2% face fee, exclusive 72h claim-lock,
`settleEscrow` = `HUNTER_PAYOUT` + `FEE_OUT`. Pool stubs on `bounties` are unused.

## Frozen rules → ticket map

PM reviews this table first. Every rule has an acceptance-criteria owner.

| # | Frozen rule | Owner ticket | Acceptance check |
| --- | --- | --- | --- |
| 1 | Eligible = non-winner, non-poster; opened ≥1 PR referencing funded `#N` **before** winning merge; that PR has ≥1 commit by them | **V2-0** fixtures + **V2-2** webhooks | Fixture table below; no pool row for winner, poster, late PR, empty-commit PR |
| 2 | Equal split among eligible; max 10 earliest by first qualifying PR `created_at`; `\|E\|=0` → winner gets 100% of post-fee | **V2-0** math + **V2-1** ledger + **V2-3** settle | Unit vectors + empty-pool settle = V1 98% |
| 3 | Drop exclusive 72h lock; parallel hunt; optional non-blocking “working on this” only | **V2-1** `work_signals` + **V2-4** UI | No new exclusive lock; many signals; board has no “Claimed by X until” |
| 4 | Fee = 2%×face → `gb-fee`; of remaining 98%: winner 85% / pool 15% (≈0.833F / 0.147F). Winner = merged PR author closing `#N` | **V2-0** math + **V2-3** settle | `100` USDC → fee `2` + winner `83.30` + pool `14.70` |

**Product done (after V2-5, not this PR):** ≥2 hunters dogfood on DEV; pool
payouts on-chain; empty-pool regression = full post-fee to winner.

## Workstream order

```text
V2-0 spike (fixtures + math, no product wire)
  └─► V2-1 schema (participants, allocation ledger, signals)
        ├─► V2-2 webhooks (eligibility + freeze)
        └─► V2-3 escrow multi-payee settle  (needs V2-1; uses freeze from V2-2)
              └─► V2-4 UI (signals, roster, breakdown; claim-lock sunset)
                    └─► V2-5 DEV dogfood
```

V2-2 and V2-3 may overlap after V2-1 lands, but settle must not pay an unfrozen
set. V1.5 WalletConnect/chips may land in parallel on `main` and must not
rewrite V2 math or eligibility.

---

## V2-0 — Spike: eligibility fixtures + split math

**Goal:** Lock the predicate and the integer math in tests **before** schema or
CDP transfers. No product UI, no migration.

**Where (when implemented):** extend `fixtures/` + `src/` / `apps/web/src/lib/money.ts`
style unit tests. This planning PR adds the fixture **spec only** (table below).

### Acceptance criteria

- [ ] Fixture file (e.g. `fixtures/pool-eligibility-cases.json`) asserts every
      row in [Pool eligibility fixtures](#pool-eligibility-fixtures).
- [ ] `splitPostFeePool(face, |E|)` (name indicative) matches [Math vectors](#math-vectors).
- [ ] `fee_atomic = floor(F × 200 / 10_000)` unchanged from ADR 0001 / V1-5.
- [ ] `|E|=0` ⇒ `pool_atomic=0`, `winner_atomic=post_fee` (empty-pool regression).
- [ ] `|E|>0` ⇒ `pool_atomic=floor(post_fee × 1500 / 10_000)`, equal `floor(pool/N)`,
      dust → winner.
- [ ] Cap: given 12 eligible timestamps, paid set is the 10 earliest `created_at`
      (tie-break `pr_number`, then `github_id`).
- [ ] No CDP calls, no Drizzle migration, no UI in the spike PR.

### Out of scope

- Writing `pool_participants`
- Changing `settleEscrow`
- WalletConnect / amount chips

---

## V2-1 — Schema: pool participants + allocation ledger

**Goal:** Persist frozen eligible set, equal shares, and one ledger row per
intended chain movement. Add non-exclusive work signals.

**Depends on:** V2-0 math types (or land math in the same PR if smaller).

### Acceptance criteria

- [ ] `bounties.participation_pool_bps` documented/default **1500 = 15% of
      post-fee**, not 15% of face. ADR 0001 sketch is superseded.
- [ ] Table `pool_participants` (name indicative) with unique `(bounty_id, github_id)`:
      `role` ∈ `winner | pool | overflow | excluded_poster | excluded_bot`;
      qualifying PR number / `created_at` / url; snapshot `commit_sha`;
      nullable `user_id`; `share_usdc`; payout hash fields; `skip_reason`.
- [ ] Table `allocation_ledger` with unique `(bounty_id, kind, participant_id)`
      and unique `idempotency_key`. `kind` ∈ `FEE_OUT | WINNER_PAYOUT | POOL_PAYOUT`.
      Status `pending | submitted | confirmed | failed`.
- [ ] Table `work_signals`: many rows per bounty (`bounty_id, user_id`);
      **no** exclusive unique index. Signal is not a money row.
- [ ] `claims` remains **winner-only**. Pool members are not `claims` rows.
- [ ] `escrows.payout_tx_hash` remains the winner hash (V1 readers). Pool hashes
      live on the new ledger / participant rows.
- [ ] Invariant test: `fee + winner + Σ pool shares = F` when `|E|>0`;
      `fee + winner = F` when `|E|=0`.
- [ ] Migration is additive. V1 exclusive `claim_locks` unique index stays until
      V2-4 sunset drain; do not acquire new exclusive locks from V2 code paths.
- [ ] Seed / fixture rows for: 2-hunter pool, 11th overflow, empty pool, poster
      excluded, unlinked `github_id`.

### Out of scope

- Webhook writer
- CDP `transferUsdc` loops
- Board/detail UI

---

## V2-2 — Webhooks: pool eligibility

**Goal:** On winning merge, freeze `E` and the winner. Optionally ingest
`opened` / `synchronize` so the roster can render before merge.

**Depends on:** V2-1. GitHub App already has `pull_requests:read` + `contents:read`
([github-app.md](github-app.md)). Subscribe to `opened` / `synchronize` /
`ready_for_review` when implementing live roster (today only `closed` is required
for V1 winner).

**Source of truth:** **merge-time backfill**, not the incremental stream.
Incremental events are UX. Freeze recomputes from GitHub (list PRs that
reference `#N`, commit authors, `created_at` vs `merged_at`).

### Acceptance criteria

- [ ] Winner path unchanged: merged PR author, default branch, closing surfaces
      from [webhooks.md](webhooks.md) → `claims.status=eligible`.
- [ ] After winner is known, compute `E` with **all five** frozen predicates
      (non-winner, non-poster, referencing PR, `created_at < merged_at`, ≥1 own
      commit on that PR at freeze).
- [ ] Draft PRs qualify. Cross-fork PRs into the bounty repo qualify.
      Cross-repo `other/repo#N` does not.
- [ ] Force-push: commit list at freeze; no reflog.
- [ ] Late PRs (`created_at >= merged_at`) written as skipped, not `pool`.
- [ ] `|E|>10`: first 10 by `created_at` (tie-break) get `role=pool`; rest
      `overflow`, `share_usdc=0`.
- [ ] Poster and winner persisted as `excluded_*` / `winner` for the roster, not paid
      from the pool.
- [ ] Bots (`type=Bot`) excluded.
- [ ] Unlinked hunters: participant row by `github_id` / login, `user_id` null,
      skip reason `hunter_not_linked` until Connect (redeliver / backfill, same
      as V1).
- [ ] Delivery idempotency: same `X-GitHub-Delivery` does not duplicate
      participants or change a freeze that already has `frozen_at`.
- [ ] Duplicate merge / `issues.closed` still does not double-write `claims`
      (existing unique `(bounty_id, pr_number)`).
- [ ] **Does not move USDC.** Does not acquire exclusive claim-lock.
- [ ] Unit tests reuse [Pool eligibility fixtures](#pool-eligibility-fixtures).

### Out of scope

- Settle / Claim payout
- WalletConnect
- Turning the signal into eligibility

---

## V2-3 — Escrow: multi-payee settle

**Goal:** `settleEscrow` pays `gb-fee` + winner + N pool members. Empty pool is
byte-for-byte the V1 winner amount (`post_fee`).

**Depends on:** V2-1. Needs a freeze from V2-2 (or a test-inserted freeze).

### Acceptance criteria

- [ ] Math uses ADR 0003 (`2%` face, then `85/15` of remainder). Not `0.15 × F`.
- [ ] Legs: `FEE_OUT`, `WINNER_PAYOUT` (`winner_atomic + dust`), `POOL_PAYOUT` × N.
- [ ] `|E|=0`: **no** `POOL_PAYOUT` rows; winner receives `post_fee`; fee `2%`.
      Automated test name this **empty-pool regression**.
- [ ] Each leg has its own idempotency key. Retry / double Claim / redelivered
      merge does not double-pay a confirmed `tx_hash`.
- [ ] `SettledPartial` when any intended leg is confirmed and another is not.
      Retry **remaining legs only**. Never reverse a confirmed transfer.
- [ ] Missing wallet / unlinked pool member: that leg stays retryable; **do not
      redistribute**. Winner + fee + other members may still confirm.
- [ ] Winner-leg failure before a hash: stay `settling` + `fail_code` (V1-5).
- [ ] Refund/cancel before settle: full `F` to funder; zero fee/pool/winner.
- [ ] Recon: attributed escrow = F − confirmed winner − confirmed pool −
      confirmed fee − refund; `Settled`/`Refunded` = 0.
- [ ] Mock rail still lists missing `CDP_*` names. Live DEV uses Base Sepolia.
      Mainnet still refused without `CDP_ALLOW_MAINNET=1`.
- [ ] Hosted checkout stays disabled.

### Out of scope

- UI breakdown (V2-4 consumes the ledger)
- Changing inbound fund / x402 Lock ([#29](https://github.com/jegamboafuentes/github-bounties/pull/29))

---

## V2-4 — UI: signals, pool roster, payout breakdown

**Goal:** Parallel hunt UX. Show who is eligible and how `F` splits. Sunset the
exclusive 72h claim-lock.

**Depends on:** V2-1; roster is live after V2-2; amounts after freeze / V2-3.

### Acceptance criteria

- [ ] **Claim-lock sunset:** `/board` and `/bounties/[id]` do not start an
      exclusive 72h lock. No “Claimed by X until …”. Residual active V1 locks
      are force-released / expired on read or via a one-shot drain job.
- [ ] Optional **“Working on this”** signal: signed-in hunter, non-blocking,
      many hunters per bounty, can clear. Not shown as exclusive. Does not
      change `E` or money.
- [ ] **Pool roster** on bounty detail: winner, each frozen pool member
      (login, qualifying PR, share), overflow count (“+K not paid, cap 10”),
      excluded poster if they opened a PR (so the rule is visible).
- [ ] **Payout breakdown:** face `F`, fee 2%, winner ≈83.3%, pool ≈14.7% (or
      100% post-fee when `E` empty), per-member equal share, each tx hash after
      settle.
- [ ] Pre-merge roster may show *candidates* (unfrozen). Copy must say
      eligibility freezes at winning merge.
- [ ] Unlinked member: Connect GitHub CTA (reuse V1 `hunter_not_linked` pattern).
- [ ] Poster / anonymous: can see roster + breakdown; cannot claim pool or
      winner payout they do not own.
- [ ] Winner Claim path still BYO Base address (V1-6). Pool members need the
      same address on Settings (or a later per-member claim — if a single
      poster/winner settle pays everyone who already has a wallet, document it
      on the page).
- [ ] Expiry cron: stop advertising exclusive lock; `expires_at` bounty refunds
      unchanged.

### Out of scope

- WalletConnect + amount chips (V1.5 polish, parallel, not blocking)
- Hosted checkout
- Redesigning Google Sign-In

---

## V2-5 — DEV dogfood + empty-pool regression

**Goal:** Meet the product done bar on `https://dev.githubbounties.xyz`.

**Depends on:** V2-1…V2-4. Ops: CDP secrets already used for V1-5 Sepolia.

### Acceptance criteria

- [ ] **≥ 2 hunters** (distinct GitHub identities, neither is the poster) each
      open a qualifying PR on a funded DEV issue **before** the winning merge;
      each PR has ≥1 commit of theirs.
- [ ] Winning merge closes `#N`; roster shows winner + both pool members;
      exclusive lock was not required.
- [ ] Settle on DEV (Base Sepolia): confirmed txs for fee, winner, and **each**
      pool member; amounts match ADR 0003; explorer links on the bounty page.
- [ ] Second funded bounty with **no** other qualifying hunters: winner
      receives **100% of post-fee**; no pool transfers. Record this as the
      empty-pool regression in [staging-e2e.md](staging-e2e.md).
- [ ] Signal (“working on this”) exercised by at least one hunter; a second
      hunter can still open a PR and be paid from the pool.
- [ ] Runbook steps added to `docs/staging-e2e.md` (DEV, not prod). No
      mainnet, no production user funds.

### Out of scope

- Production marketing
- Load tests
- V1.5 WalletConnect polish

---

## Pool eligibility fixtures

Implement in V2-0 / V2-2. `issue` is funded `#42` unless noted. Winner merge is
PR `#100`, `merged_at=T1`, author `winner`. Poster GitHub `poster`.

| id | Setup | In `E`? |
| --- | --- | --- |
| `qualifying-basic` | `alice` opened PR `#10` at `T1-1h`, body `Refs #42`, 1 commit by alice | yes |
| `qualifying-draft` | same as basic, `draft: true` | yes |
| `qualifying-fork` | `bob` PR from a fork, base = bounty repo, `Fixes #42`, own commit | yes |
| `qualifying-closed-unmerged` | `cara` PR closed unmerged before `T1`, `Related to #42`, own commit | yes |
| `qualifying-title-hash` | `dan` PR title `#42 hunt`, body empty, own commit | yes |
| `winner-excluded` | `winner` also opened `#9` earlier with `Fixes #42` | **no** (winner) |
| `poster-excluded` | `poster` opened `#8` `Refs #42` with own commit | **no** (poster) |
| `late-pr` | `erin` opened `#101` at `T1+1s` `Fixes #42`, own commit | **no** |
| `no-own-commit` | `frank` opened `#11` `Refs #42`, commits only by `other` | **no** |
| `force-push-lost-commits` | `gina` force-pushed before `T1`; freeze commit list has none of hers | **no** |
| `force-push-after-freeze` | `gina` had a commit at `T1`, force-push after settle | **yes** (snapshot) |
| `cross-repo` | `hank` PR on `other/repo` `Fixes bounty/repo#42` | **no** |
| `bot-excluded` | `dependabot` opened a PR referencing `#42` | **no** |
| `coauthor-on-winner-only` | `ivy` Co-authored-by on winning `#100`, no own PR | **no** |
| `late-commit-on-old-pr` | `jake` opened `#12` at `T1-1d` with only `other`’s commits; jake’s commit pushed after `T1` | **no** |
| `cap-11th` | 11 hunters otherwise qualifying; `#11` has latest `created_at` | first 10 yes; 11th overflow |
| `tie-created-at` | two PRs same `created_at`; lower `pr_number` wins the cap slot | deterministic |
| `empty-pool` | only winning PR exists | `E=∅` |
| `not-funded` | bounty `pending_fund` | no winner claim, no pool |
| `refs-only-vs-close` | `Refs #42` (not a closer) on a non-winner PR | **yes** for pool (not sufficient to be the winner) |

Winner fixtures stay in [webhooks.md](webhooks.md) (`Fixes #42` merged to default).
A `Refs #42` PR **cannot** be the winning closer unless another closing surface
exists.

---

## Math vectors

`fee_bps=200`. `pool_bps_of_post_fee=1500`. Amounts are USDC strings (6 dp).

| face | \|E\| | fee | winner | pool total | each | dust→winner |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100.000000 | 0 | 2.000000 | **98.000000** | 0 | — | 0 |
| 100.000000 | 2 | 2.000000 | 83.300000 | 14.700000 | 7.350000 | 0 |
| 100.000000 | 10 | 2.000000 | 83.300000 | 14.700000 | 1.470000 | 0 |
| 1.000000 | 0 | 0.020000 | 0.980000 | 0 | — | 0 |
| 1.000000 | 3 | 0.020000 | 0.833000 | 0.147000 | 0.049000 | 0 |
| 0.010000 | 4 | 0.000200 | 0.008332 | 0.001468 | 0.000367 | 0.000002 |

Conservation: `fee + winner + N × each = face`. Winner column includes `dust` (`pool_atomic − N × each`); `pool total` is `N × each` (what actually leaves escrow to the pool).

Check vs PM approx: `83.30 / 100 = 0.833`, `14.70 / 100 = 0.147`.

---

## Parallel: V1.5 WalletConnect + amount chips (not V2)

Ship independently after x402 [#29](https://github.com/jegamboafuentes/github-bounties/pull/29)
(exact Lock without paste-hash):

| Polish | Notes |
| --- | --- |
| WalletConnect on fund / claim address entry | UX only. Does not change face, fee, or `E`. |
| Amount chips on create/fund | Presets for `amount_usdc`. Still 2 dp / product min. |

**Do not** block V2-0…V2-5 on this polish. **Do not** fold WalletConnect into
the V2 settle PR. If both land near each other, rebase only — no shared
schema.

---

## Explicit non-goals for **this** planning PR

- No Drizzle migration
- No `settleEscrow` signature change
- No new webhook actions
- No board/detail React changes
- No `CLAIM_LOCK_HOURS` constant change in code
- No WalletConnect dependency

Implementation happens in follow-up PRs titled `V2-0` … `V2-5` against `main`,
each mapping to the acceptance lists above.

## Suggested GitHub issue titles (open when implementing)

1. `V2-0: pool eligibility fixtures + post-fee 85/15 math`
2. `V2-1: schema pool_participants + allocation_ledger + work_signals`
3. `V2-2: webhooks freeze pool E on winning merge`
4. `V2-3: escrow multi-payee settle (winner + N pool + fee)`
5. `V2-4: UI signals, roster, payout breakdown; drop 72h exclusive lock`
6. `V2-5: DEV dogfood ≥2 hunters + empty-pool regression`
