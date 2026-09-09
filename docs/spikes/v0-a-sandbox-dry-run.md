# V0-A spike: sandbox / dry-run evidence

**Date:** 2026-09-09  
**ADR:** [0001-cdp-x402-wallets.md](../adr/0001-cdp-x402-wallets.md)  
**Stub:** [`scripts/money-path-dry-run.mjs`](../../scripts/money-path-dry-run.mjs)

## Result: BLOCKED (expected) — no live USDC

This Cloud Agent workspace has **no CDP credentials** in the environment and **no
gcloud access** to Secret Manager on `github-bounties` (`133702056111`).

A live Base Sepolia fund→release was **not** attempted. No mainnet, no production
user funds, no secrets committed.

### Exact missing credentials

| Name | Where it should live | Status 2026-09-09 |
| --- | --- | --- |
| `CDP_API_KEY_ID` | GCP Secret Manager id `CDP_API_KEY_ID` → env | **MISSING** |
| `CDP_API_KEY_SECRET` | GCP Secret Manager id `CDP_API_KEY_SECRET` → env | **MISSING** |
| `CDP_WALLET_SECRET` | GCP Secret Manager id `CDP_WALLET_SECRET` → env | **MISSING** |
| `CDP_PROJECT_ID` | optional | absent |
| `CDP_CLIENT_API_KEY` | optional (Embedded Wallets later) | absent |

Create the three required values in the [CDP Portal](https://portal.cdp.coinbase.com/projects/api-keys)
(Secret API Key + Wallet Secret), then:

```bash
gcloud config set project github-bounties   # 133702056111
gcloud secrets create CDP_API_KEY_ID --replication-policy=automatic
# ...repeat for CDP_API_KEY_SECRET and CDP_WALLET_SECRET
echo -n 'VALUE' | gcloud secrets versions add CDP_API_KEY_ID --data-file=-
```

After that, re-run:

```bash
export CDP_NETWORK=base-sepolia
export CDP_DRY_RUN_LIVE=1
node scripts/money-path-dry-run.mjs
```

That live path faucets **test** USDC on Base Sepolia into `gb-escrow`, then transfers
98% to `gb-hunter-dry` and 2% to `gb-fee`. It still **refuses** `CDP_NETWORK=base`.

### Command actually run

```bash
node scripts/money-path-dry-run.mjs
# exit 2
```

```
GitHub Bounties — V0-A money-path dry-run
Network: base-sepolia
Live Base Sepolia requested: no

Secret probe (values redacted):
  CDP_API_KEY_ID: MISSING
  CDP_API_KEY_SECRET: MISSING
  CDP_WALLET_SECRET: MISSING
  CDP_PROJECT_ID: absent (optional)
  CDP_CLIENT_API_KEY: absent (optional)

Offline ledger fixture (100.000000 USDC face):
  fee_atomic     = 2000000 (2.000000 USDC)
  hunter_atomic  = 98000000 (98.000000 USDC)
  claim-lock     = coordination only; no ledger money row
…

BLOCKED: sandbox/dry-run cannot call CDP. Missing credentials:
  - GCP Secret Manager / env: CDP_API_KEY_ID
  - GCP Secret Manager / env: CDP_API_KEY_SECRET
  - GCP Secret Manager / env: CDP_WALLET_SECRET

Expected location:
  GCP project github-bounties (133702056111)
  Secret IDs: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
  Create in CDP Portal → Secret API Key + Wallet Secret, then store in Secret Manager.
  Docs: https://docs.cdp.coinbase.com/get-started/docs/cdp-api-keys

No live USDC transfer was attempted.
```

Mainnet guard:

```bash
CDP_NETWORK=base node scripts/money-path-dry-run.mjs
# exit 2
# BLOCKED: CDP_NETWORK looks like mainnet. Dry-run refuses real USDC prod spend.
```

### Offline fee math (no chain)

`fee_atomic = floor(face * 2 / 100)`, remainder to hunter:

| face_atomic | fee | hunter | notes |
| ---: | ---: | ---: | --- |
| 1 | 0 | 1 | below 50 atomic, 2% truncates to 0 |
| 50 | 1 | 49 | smallest non-zero fee |
| 1_000_000 (1 USDC) | 20_000 | 980_000 | faucet-sized |
| 100_000_000 (100 USDC) | 2_000_000 | 98_000_000 | ADR fixture |
| 1_234_567 | 24_691 | 1_209_876 | remainder conserved |

## What we did **not** call

- Coinbase Business Checkouts (`https://business.coinbase.com/api/v1/checkouts`) — would need the same JWT secrets; sandbox anyway **omits `x402_url`** per CDP docs.
- CDP Facilitator verify/settle
- `CdpClient` faucet or `transfer`
- Base mainnet

## Unblock checklist (ADR Accepted)

1. [ADR 0001](../adr/0001-cdp-x402-wallets.md) is **Accepted** (PR #1). Still no prod-wire of escrow into product UI until V1 tickets.
2. Create CDP sandbox project keys; store the three required secrets in GCP `github-bounties`.
3. Grant runtime SA `secretmanager.secretAccessor`.
4. Run `CDP_DRY_RUN_LIVE=1` on Base Sepolia only; paste tx hashes into this spike.
5. Only then consider V1 wiring (still not production user funds until a later go-live).
