# Architecture Decision Records

This directory records money-path and platform decisions for **GitHub Bounties**.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-cdp-x402-wallets.md) | CDP wallets + x402 USDC escrow, 2% fee | Proposed — do not prod-wire until signed |

## Rules

- New ADRs are numbered sequentially (`0002-…`).
- Status values: `Proposed` → `Accepted` or `Rejected` / `Superseded`.
- **Do not production-wire escrow, checkout, or fee collection until ADR 0001 is Accepted.**
