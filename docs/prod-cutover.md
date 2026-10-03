# Production — `githubbounties.xyz`

PROD is live. Cloud Run service `github-bounties-web-prod` in GCP project
`experiment-jegf` / `42206083192`, region `us-central1`, apex
**`https://githubbounties.xyz`**. DEV stays `github-bounties-web` at
`https://dev.githubbounties.xyz`. Do not remount the DEV service, DEV Cloud
SQL, or the DEV GitHub / Google clients onto the apex.

Enrique greenlit GO PROD on **2026-09-19**. This file describes how that
stack runs. It does not create GCP resources.

Staging remains [`staging-deploy.md`](staging-deploy.md). Hosted Coinbase
checkout stays **OFF**.

---

## Shared CDP project

DEV and PROD use **one CDP project and one wallet secret**. The named server
accounts are the same addresses on both:

| Account | Address |
| --- | --- |
| `gb-escrow` | `0x4a26235bf51c73048635d607EB5371E9b3e611B8` |
| `gb-fee` | `0xf34b4BDd02FFFf225b1c7779C7A316148b907BA8` |

`getOrCreateAccount({ name: "gb-escrow" })` and `getAccount({ name: "gb-fee" })`
resolve to those addresses in the shared project. There is no `PROD_CDP_*`
secret set. Both services bind the same CDP secret ids (`CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `CDP_PROJECT_ID`,
`CDP_CLIENT_API_KEY`).

**Only `CDP_NETWORK` separates them.**

| | DEV | PROD |
| --- | --- | --- |
| `CDP_NETWORK` | `base-sepolia` | `base` (`base-mainnet` / `eip155:8453` are the same chain) |
| `CDP_ALLOW_MAINNET` | unset | `1` |
| USDC | Sepolia test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Public API money | on when `API_MONEY_ENABLED` is unset | **off** when `API_MONEY_ENABLED` is unset |

Sepolia balances and mainnet balances do not mix. They are still the same
accounts. The wallet secret on DEV can sign mainnet if that process sets
`CDP_NETWORK=base` and `CDP_ALLOW_MAINNET=1`. DEV must not set that flag.

Enrique accepts the shared project and wallets for now.

Cloud Run services, hosts, and databases stay separate. Do not point PROD
`DATABASE_URL` at `github-bounties-staging`.

---

## MUST-DO — split CDP before PROD API money

**MUST-DO:** Split DEV and PROD into separate CDP projects, API keys, and
wallets **before** `API_MONEY_ENABLED` is turned on for PROD.

Unset, `API_MONEY_ENABLED` is on for `base-sepolia` and off for `base`. Leave
it unset or `0` on `github-bounties-web-prod`. Do not set it to `1` while
`gb-escrow` and `gb-fee` are shared. Public REST and MCP fund, top-up, claim,
and refund would then move mainnet USDC from the same wallets DEV uses.

The split is a new CDP project, new API keys, and a new wallet secret so the
PROD `gb-escrow` and `gb-fee` addresses are not the ones in the table above.
Move mainnet USDC and ETH to those new wallets before switching the PROD
secret. This change does not do that split.

---

## Plain env on PROD

| Env | PROD | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `AUTH_TRUST_HOST` | `true` | |
| `AUTH_URL` | `https://githubbounties.xyz` | Do not point this at the admin host |
| `PUBLIC_BASE_URL` | `https://githubbounties.xyz` | GitHub URL helpers + WalletConnect metadata origin |
| `CDP_NETWORK` | `base` | Also accepts `base-mainnet` / `eip155:8453` |
| `CDP_ALLOW_MAINNET` | `1` | Required. Client + rail stay Sepolia if this is unset |
| `API_MONEY_ENABLED` | omit or `0` | See the MUST-DO above. Do not turn it on until CDP is split |
| `BASE_BUILDER_CODE` | omit until Enrique's GO | Public code `bc_u97ii222`, not a secret. Set on DEV first. Set the same value on PROD only after Sepolia fund and payout checks pass and Enrique says GO. Unset is a no-op |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Reown project id | Public; not Secret Manager. Apex must be allowlisted |
| `PORT` | `8080` | Cloud Run |

`deploy-web.sh` / `web_plain_env_pairs` pass `CDP_NETWORK` (default
`base-sepolia`) and, **only if set**, `CDP_ALLOW_MAINNET`. For PROD:

```bash
export CDP_NETWORK=base
export CDP_ALLOW_MAINNET=1
export PUBLIC_BASE_URL=https://githubbounties.xyz
export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID='<reown-project-id>'
```

Without `CDP_ALLOW_MAINNET=1`, WalletConnect / Pay stay on Base Sepolia and
`eip155:8453` is `mainnet_refused` — even if `CDP_NETWORK=base`.

Do not export `API_MONEY_ENABLED=1` on this service until the MUST-DO split
has shipped.

---

## Health

Expect `escrow.hosted_checkout.enabled === false` and `escrow.rail === "cdp"`.
With the shared CDP secrets and the allow flag:

```json
{
  "ok": true,
  "service": "github-bounties-web",
  "escrow": {
    "rail": "cdp",
    "network": "base",
    "missing": [],
    "hosted_checkout": { "enabled": false },
    "mainnet_refused": false,
    "builderCode": null
  }
}
```

`service` in JSON is the product name (`github-bounties-web`), not the Cloud
Run service id. `builderCode` is `null` until `BASE_BUILDER_CODE` is set.
An invalid code fails this check.

- [ ] `GET /api/health` is HTTP 200
- [ ] `escrow.network` is `base`
- [ ] `escrow.mainnet_refused` is `false`
- [ ] `escrow.hosted_checkout.enabled` is `false`
- [ ] `API_MONEY_ENABLED` is unset or `0`
- [ ] WalletConnect metadata origin is the apex, not `dev.githubbounties.xyz`

---

## Chain selection

The fund / WalletConnect client follows the rail at **runtime**. There is no
`NEXT_PUBLIC_CDP_*` rebuild.

- `CDP_NETWORK` in `{base, base-mainnet, eip155:8453}` **and**
  `CDP_ALLOW_MAINNET` truthy (`1` / `true` / `yes`) → wagmi `base`, native
  USDC, Pay path allowed, live x402 seller registers `eip155:8453`.
- Otherwise → Base Sepolia. Mainnet challenges stay `mainnet_refused`.
- WalletConnect metadata `url` / icons come from `PUBLIC_BASE_URL` or
  `AUTH_URL`, then `http://localhost:3000`.

---

## Out of scope

- Creating a second CDP project, key, or wallet in this change.
- Turning `API_MONEY_ENABLED` on for PROD.
- Hosted checkout.
- Remounting or retargeting DEV.
