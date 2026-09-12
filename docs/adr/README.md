# Architecture Decision Records

This directory records money-path and platform decisions for **GitHub Bounties**.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-cdp-x402-wallets.md) | CDP wallets + x402 USDC escrow, 2% fee | **Accepted** (PR #1) |
| [0002](./0002-x402-exact-dev-fund.md) | DEV fund Lock via x402 `exact` (hosted checkout still off) | **Proposed** |

## Rules

- New ADRs are numbered sequentially (`0002-…`).
- Status values: `Proposed` → `Accepted` or `Rejected` / `Superseded`.
- **Accepted** — still no prod-wire of escrow into product UI until V1 tickets; Secret Manager + Sepolia dry-run OK when credentials exist.
