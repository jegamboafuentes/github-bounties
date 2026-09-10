# Google Sign-In (V1-2)

Product users sign in with **Google**. App identity is `users.google_sub`. The GitHub App is repo authority only (install + webhooks in **V1-3**). GitHub App user-to-server OAuth only links `github_links` after a Google session — it is not product login.

Official name: **GitHub Bounties**. GCP project: `experiment-jegf` / `42206083192`.

## Library

**Auth.js (NextAuth v5)** — `next-auth@beta`, Google provider, JWT session strategy.

Why this boring choice:

- First-party App Router + Next.js 16 support (`handlers` + `proxy.ts`)
- Google provider is maintained
- Encrypted JWT session cookie is **httpOnly**, `SameSite=lax`, and **Secure in production**
- No extra accounts/sessions tables; we upsert our own `users` row

On login the jwt callback creates or updates `users` keyed by `google_sub` and stores `email` + `display_name`.

| Piece | Path |
| --- | --- |
| Auth.js config | [`apps/web/src/auth/`](../apps/web/src/auth/) |
| Route handler | `/api/auth/*` → [`apps/web/src/app/api/auth/[...nextauth]/route.ts`](../apps/web/src/app/api/auth/[...nextauth]/route.ts) |
| Protected page | `/settings` |
| Protected APIs | `GET /api/me`, `GET\|POST /api/github/connect` |
| Edge gate | [`apps/web/src/proxy.ts`](../apps/web/src/proxy.ts) (Next.js 16; not `middleware.ts`) |

Public: `/`, `/signin`, `/board`, `/bounties/[id]`, `/api/health`, `/api/auth/*`, `POST /webhooks/github` (HMAC), claim-lock expiry job. `/github/setup`, `/github/callback`, and `/bounties/new` require a Google session.

## Local env

```bash
cd apps/web
cp .env.example .env
# set DATABASE_URL (local Docker Compose) plus the Google / Auth.js vars below
```

| Variable | Secret Manager key | Purpose |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Web client id |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth Web client secret |
| `AUTH_SECRET` | `AUTH_SECRET` | Auth.js cookie encryption (random 32+ bytes) |
| `DATABASE_URL` | `DATABASE_URL` | Persist `users.google_sub` (V1-1) |
| `AUTH_URL` | — | Optional. Public origin, e.g. `http://localhost:3000` |

Generate `AUTH_SECRET` locally with `npx auth secret` or `openssl rand -base64 32`. **Never commit the value.**

If `GOOGLE_*` / `AUTH_SECRET` / `DATABASE_URL` are unset, `/signin` lists the missing names and does not start OAuth. The rest of the app (home, `/api/health`) still boots. CI does not call live Google.

## Google Cloud OAuth client

In GCP project **experiment-jegf** (`42206083192`):

1. [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=experiment-jegf) → **Create credentials** → **OAuth client ID** → application type **Web application**.
2. Name it something like `github-bounties-web` (local + staging can share one client if every URI below is listed).
3. Authorized **JavaScript origins** and **redirect URIs**:

### Localhost

| Kind | Value |
| --- | --- |
| JS origin | `http://localhost:3000` |
| Redirect URI | `http://localhost:3000/api/auth/callback/google` |

Optional extra origin/URI with `127.0.0.1` if you open that host instead of `localhost`.

`next dev` defaults to port 3000. If you change the port, add matching URIs.

### Staging Cloud Run URL pattern

Do **not** invent a `*.run.app` host. After Cloud Run exists, add the **real** service URL:

| Kind | Pattern |
| --- | --- |
| JS origin | `https://<service>-<hash>-<region>.a.run.app` |
| Redirect URI | `https://<service>-<hash>-<region>.a.run.app/api/auth/callback/google` |

Newer Cloud Run URLs look like `https://<service>-<project-number>.<region>.run.app` (project number `42206083192`). Use whichever host the service actually serves. Custom domains: `https://<your-domain>/api/auth/callback/google`.

`PUBLIC_BASE_URL` in the repo-root `.env.example` is a docs placeholder (`https://github-bounties-staging.example.com`), not a live host. After V1-7 deploy, use the real `github-bounties-web` origin from `gcloud run services describe` ([staging-deploy.md](staging-deploy.md)).

4. Copy the client id and secret into local `.env` or Secret Manager. Ops sets Secret Manager versions out-of-band.

## Local run

```bash
docker compose up -d postgres
cd apps/web
cp .env.example .env   # set DATABASE_URL + GOOGLE_* + AUTH_SECRET
npm install
npm run db:migrate
npm run db:seed
npm run dev            # http://localhost:3000
```

1. Open `/signin` → **Continue with Google**.
2. After consent, a `users` row exists for that `google_sub`.
3. `/settings` shows the persisted profile. `GET /api/me` returns the same user.
4. **Sign out** clears the session cookie.
5. **Connect GitHub** starts the GitHub App install (V1-3). Requires App env; otherwise Settings lists the missing names.

Without Google env, `/signin` shows the missing-variable list. `/settings` and `/api/me` still require a session (redirect / `401`).

## Session cookies

Auth.js JWT cookie:

| Env | Name | Flags |
| --- | --- | --- |
| Development | `authjs.session-token` | `HttpOnly; Path=/; SameSite=Lax` |
| Production | `__Secure-authjs.session-token` | `HttpOnly; Path=/; SameSite=Lax; Secure` |

`AUTH_SECRET` must be set in production (Cloud Run / Secret Manager) so cookies are not signed with the local fallback.

## Out of scope

- CDP / x402 (V1-5)
- Payout claim UI (V1-6)
- Pasting or requesting real OAuth client secrets
