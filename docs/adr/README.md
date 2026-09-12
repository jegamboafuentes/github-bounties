# Architecture Decision Records

This directory records money-path and platform decisions for **GitHub Bounties**.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-cdp-x402-wallets.md) | CDP wallets + x402 USDC escrow, 2% fee | **Accepted** (PR #1) |
| [0002](./0002-x402-exact-dev-fund.md) | DEV fund Lock via x402 `exact` (hosted checkout still off) | **Proposed** |
| [0003](./0003-v2-multi-hunter-pool.md) | V2 multi-hunter participation pool | **Proposed** (plan/docs only; no V2 code) |

[0003](./0003-v2-multi-hunter-pool.md) supersedes the ADR 0001 V2 sketch (`pool ≈ 0.15 × F`). Frozen math is **15% of post-fee**. Tickets: [docs/v2-tickets.md](../v2-tickets.md). **Do not implement V2 in the planning PR.** V1.5 WalletConnect + amount chips is parallel polish after x402 [#29](https://github.com/jegamboafuentes/github-bounties/pull/29) and does not block 0003.

## Rules

- New ADRs are numbered sequentially (`0004-…`).
- Status values: `Proposed` → `Accepted` or `Rejected` / `Superseded`.
- **Accepted** — still no prod-wire of escrow into product UI until V1 tickets; Secret Manager + Sepolia dry-run OK when credentials exist.
