# Security audits

`2026-09-24-audit.sql` is read-only. Every runnable statement is a `SELECT`.
Do not add correction `UPDATE`s to that file.

## Funder address and top-up markers

`escrows.funder_address` has to be the on-chain sender of the recorded fund
transaction: the `from` of the USDC `Transfer` into the escrow wallet
(`escrows.escrow_address`, the x402 payTo) for the amount recorded on that
transaction. It is never the poster's saved wallet, never a contribution-funder
fallback, and never an address typed by hand. A wallet the poster saves after
Lock is a different address from the sender of the original fund transaction.

A verified x402 top-up is stored by keeping the existing `escrows.x402_payment_id`
and appending one line per settled hash:

```
x402-topup:<contribution fund tx hash>
```

That is the same shape as `withVerifiedTopUpHash` in
`apps/web/src/escrow/payout-guard.ts`. The line is how Claim counts the
contribution. Append it only after that contribution's transaction matches
on-chain the same way (configured USDC, `to` the escrow wallet, amount equal
to the contribution).

The one-off tool `apps/web/scripts/security/derive-funder-corrections.ts`
prints proposed `UPDATE`s for those two cases. It does not write to the
database. Postgres is opened read-only. Chain and USDC come from
`CDP_NETWORK` / `CDP_ALLOW_MAINNET` (Base mainnet on PROD, Base Sepolia on
DEV). Receipts come from `BASE_RPC_URL`. The tool refuses a row when there
is no matching log, more than one match, a token other than the configured
USDC, or a sender equal to the escrow wallet.

## How Ops runs this on PROD

1. Use the PROD environment: `DATABASE_URL`, `CDP_NETWORK=base`, and
   `CDP_ALLOW_MAINNET=1`. Set `BASE_RPC_URL` to a Base mainnet JSON-RPC
   endpoint (chain id 8453). Do not point it at Base Sepolia.
   DEV uses `CDP_NETWORK=base-sepolia` (the default, without
   `CDP_ALLOW_MAINNET`) and a Base Sepolia RPC (chain id 84532). The tool
   exits if the RPC chain id does not match that selection.
2. From `apps/web`, run:

```
npm run security:derive-corrections
```

   The command only reads. Stdout is SQL wrapped in `BEGIN` / `ROLLBACK`,
   with the tx hash, block, log index, from, to, and amount in comments.
   Stderr is a one-line count. The process never executes `UPDATE`.
3. Send that stdout to the owner.
4. Nobody runs `UPDATE`s on PROD without the owner's OK.
5. After the owner approves, Ops applies the reviewed script in a separate
   step. The printed trailer is `ROLLBACK`, so pasting it does not commit.
   Applying means changing that trailer to `COMMIT` only in the
   owner-approved copy, then running that copy. If time has passed, rerun
   the tool and compare the evidence before applying.

There is no address argument. Do not pass a sender, a poster wallet, or the
escrow wallet on the command line.

## Legacy funding the payout guard does not count yet

Claim, refund, and expiry refuse a payout when verified inflow does not cover
the remaining legs. On the live rail a hash counts when x402 settle recorded
it, or when `escrows.x402_payment_id` contains `x402-topup:<hash>`. A hash
that already has that marker keeps counting. The facilitator settled it, and
the recorded payer is whoever x402 reported. There is no extra on-chain payer
check for those hashes. DEV `7bf910cc`'s cross-account top-up from `0xacc0…`
already has the marker, so it is covered and the dry-run does not list it.

The on-chain payer check applies only to an unmarked legacy hash being newly
verified: configured USDC, `Transfer` to the escrow address, `from` the
recorded payer, amount at least the recorded amount, and the hash not used by
any other bounty. Placeholder hashes (`lock:`, `legacy-fund:`, or any string
that is not a 32-byte transaction hash) never count. Among open DEV bounties,
`b99a9163`'s `0xfd0a…641f` leg is the unmarked contribution.

`apps/web/scripts/security/reconcile-legacy-funding.ts` lists bounties whose
legs would fail that check. By default it scans only open or unfinished
bounty or escrow statuses: `funded`, `claim_locked`, `settling`,
`settled_partial`, and `refunding`. Already settled, refunded, cancelled,
expired, void, and pending_fund rows are not scanned. `--include-settled`
scans every status. Settled DEV bounties such as `0aef5f9a`, `145f3f18`, and
`434a1afc` are noise under the default filter. It does not change bounty
status and it does not send USDC.

Dry-run is the default and is safe on PROD. Postgres is opened read-only.
Stdout is one JSON object per at-risk leg (`legacy_fund_at_risk` with
`bountyId`, `hash`, `reason`, `chainFrom`, `recordable`). Stderr is one line:
`scanned` N, `flagged` M, and `filter=open` or `filter=all`. `--apply` appends
`x402-topup:` lines only for legs whose receipt matched. It does not invent
hashes.

`--apply` on mainnet (`CDP_NETWORK=base` or equivalent) exits without writing
unless both `--allow-prod` and `LEGACY_FUND_RECONCILE_ALLOW_PROD=1` are set.
CDP API keys are not required. `DATABASE_URL` is. Receipts use `BASE_RPC_URL`
when it is set, otherwise the public Base RPC for the configured network. The
script exits if that RPC chain id does not match.

From `apps/web`, against DEV first:

```
npm run security:reconcile-legacy-funding
npm run security:reconcile-legacy-funding -- --include-settled
npm run security:reconcile-legacy-funding -- --apply
```

Read the dry-run before `--apply`. On DEV the expected output is `b99a9163`
only. `7bf910cc` is not flagged. A `payer_mismatch` row is an unmarked hash
whose on-chain sender is not the recorded payer; it is listed and is not
recorded. After a recordable hash is cached, a new refund call (new
idempotency key) skips legs that already have a refund tx and pays only the
remaining recorded payers.

PROD dry-run:

```
npm run security:reconcile-legacy-funding
```

Add `--include-settled` only when a terminal bounty needs to be listed. The
default dry-run does not.

Do not pass `--apply` on PROD unless the owner has approved that specific run
and both gates above are set. Applying still only writes verified
`x402-topup:` lines.

## Migrate 0010 — case-insensitive fund hashes

Migration `0010_case_insensitive_fund_tx_hash` replaces the 0009 unique
indexes on `bounty_contributions.fund_tx_hash` and `escrows.fund_tx_hash`
with unique indexes on `lower(fund_tx_hash)`. 0009 did not index any other
hash column. The migration does not `UPDATE` existing rows. If two rows
collide under `lower()`, it raises and leaves the 0009 indexes in place.

DEV needs `migrate 0010` for the new indexes to exist. Run this pre-check
on DEV and on PROD before migrating. Do not run it as a substitute for the
owner's OK on PROD, and do not apply 0010 on PROD from this change by itself.
A row means stop: those hashes collide when case is ignored.

```sql
SELECT source, count(*) AS duplicate_groups
FROM (
  SELECT 'bounty_contributions' AS source
  FROM bounty_contributions
  WHERE fund_tx_hash IS NOT NULL
  GROUP BY lower(fund_tx_hash)
  HAVING count(*) > 1
  UNION ALL
  SELECT 'escrows' AS source
  FROM escrows
  WHERE fund_tx_hash IS NOT NULL
  GROUP BY lower(fund_tx_hash)
  HAVING count(*) > 1
) d
GROUP BY source;
```

An empty result is the healthy case (zero case-insensitive duplicate groups).
The migration file header has the matching detail query.

## Legacy escrow-wallet funder (PROD bbcc9ee5)

`contributionRefundPlan` does not substitute another address when a
contribution's `funder_address` is the escrow wallet. A multi-funder refund
plans that leg to the stored funder address. `readStoredTransferDestination`
refuses to treat the escrow wallet (x402 payTo) as a refund destination, so
the transfer guard fails safe with `destination_mismatch` and sends nothing.

That is the intended fail-safe for legacy rows whose funder is the escrow
wallet. PROD bounty `bbcc9ee5` is the known case. The fix is the
on-chain-derived correction from PR #72 (`npm run security:derive-corrections`),
which sets `funder_address` to the USDC Transfer `from` of the recorded fund
transaction. Do not add a code fallback in `contributionRefundPlan` to the
poster's saved wallet or to any other address.
