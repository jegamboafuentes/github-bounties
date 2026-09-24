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
