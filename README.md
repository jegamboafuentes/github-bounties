# GitHub Bounties

USDC bounties on GitHub issues. Official name: **GitHub Bounties**.

This is not Lightning Bounties, LB1, or “Lightning Bounties 2”.

## Money path status

[ADR 0001](docs/adr/0001-cdp-x402-wallets.md) is **Accepted** (product sign-off on PR #1).

**Accepted** — still no prod-wire of escrow into product UI until V1 tickets; Secret Manager + Sepolia dry-run OK when credentials exist. No real USDC production spend. No production user funds.

## Money path (V0-A)

| Item | Lock |
| --- | --- |
| Rail | CDP server wallets + x402 USDC on Base (Sepolia in sandbox) |
| Escrow | Platform CDP wallet `gb-escrow` holds face value |
| Fee | **2% of bounty face** at **settlement**: `fee = floor(face * 0.02)`, hunter gets the remainder |
| Claim-lock | V1 exclusive **72h** coordination lock — **does not move money** |
| V2 | ~15% participation pool later; fee still on full face; not implemented |

Read the decision, sequences, failure modes, and GCP Secret Manager names in:

- [ADR 0001 — CDP wallets + x402 USDC escrow](docs/adr/0001-cdp-x402-wallets.md)
- [ADR index](docs/adr/README.md)

## V0-A scope

**In**

- ADR (custody, 2% fee, fund → claim-lock → merge/release → refund)
- Secret Manager key names for GCP project `github-bounties` (`133702056111`)
- Sandbox/dry-run notes and a credential-safe stub

**Out** (later tickets)

- Production escrow wired into UI
- Fee dashboards
- Participation pool
- Full app scaffold (V0-B / V0-C)

## Sandbox dry-run

```bash
node scripts/money-path-dry-run.mjs
```

Without `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET` the script
**exits 2** and lists the exact missing secrets. It never broadcasts mainnet USDC.

Optional Base Sepolia live fund→release (test USDC only) requires those secrets **and**
`CDP_DRY_RUN_LIVE=1`. See [spike notes](docs/spikes/v0-a-sandbox-dry-run.md).

Copy [.env.example](.env.example) locally. Do not commit `.env`.

## Product constants

- Platform fee: 2% of face
- V1 claim-lock: 72 hours, exclusive, coordination only
- GCP: `github-bounties` / `133702056111`
