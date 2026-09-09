# GitHub Bounties — web app

Next.js App Router (TypeScript) for Cloud Run, plus the V1 Postgres schema.

**ORM: Drizzle** — SQL-first, versioned migrations next to the app, no Prisma generate step. Schema is the contract for V1-2…V1-6 ([docs/v1-schema.md](../../docs/v1-schema.md)).

This package does **not** replace `services/hello` (Cloud Run canary) or the V0-B webhook stub at repo-root `src/`.

## Product locks

| Item | Value |
| --- | --- |
| Name | GitHub Bounties |
| Fee | 2% → `fee_ledger.fee_bps` default **200** |
| Claim-lock | exclusive **72h** (`expires_at` default `now() + 72 hours`) |
| Winner | schema only: merged PR author closing `#N` |
| CDP / x402 | **not wired** (ADR 0001 Accepted; live calls are V1-5) |

## Local Postgres + migrate

Docker (from the **repository root**):

```bash
docker compose up -d postgres
# wait until healthy (docker compose ps)
```

Compose uses a **local placeholder** role (see `docker-compose.yml`). That is not Cloud SQL and not a staging password.

```bash
cd apps/web
cp .env.example .env
# set DATABASE_URL to your local Postgres (placeholder user from compose)
npm install
npm run db:migrate    # applies drizzle/ on an empty database
npm run db:seed
npm run test:unit
npm run test:db
npm run dev           # http://localhost:3000  and  /api/health
```

Without Docker, any Postgres 16 is fine. Create an empty database and point `DATABASE_URL` at it. Do not commit `.env`.

Re-running migrate and seed is safe (idempotent).

### Evidence command

```bash
cd apps/web && npm run db:migrate && npm run db:seed && npm run test:unit && npm run test:db
```

CI runs the same against an empty `postgres:16` service (`.github/workflows/ci.yml`).

## Cloud SQL (staging)

Instance **`github-bounties-staging`** exists in GCP project `experiment-jegf` / `42206083192`, database `github_bounties`.

1. Ops places the connection string in Secret Manager key **`DATABASE_URL`**. Do not invent or ask for the password in chat/PRs.
2. Reach the instance with Cloud SQL Auth Proxy or a Cloud Run job that mounts the unix socket (see [docs/gcp-bootstrap.md](../../docs/gcp-bootstrap.md)).
3. Export `DATABASE_URL` in your shell **from the secret** (never paste it into git).
4. From `apps/web`: `npm run db:migrate` then optionally `npm run db:seed` (seed is for empty/dev DBs).

Shapes (password never in git):

```text
# Auth Proxy
postgresql://gb_app:PASSWORD@127.0.0.1:5432/github_bounties?sslmode=require

# Cloud Run unix socket
postgresql://gb_app:PASSWORD@/github_bounties?host=/cloudsql/experiment-jegf:us-central1:github-bounties-staging
```

## Cloud Run

`output: "standalone"` and [`Dockerfile`](./Dockerfile) listen on `PORT` (default 8080). Staging Cloud Build still deploys `services/hello` only; do not point `cloudbuild.yaml` at this app until a later ticket.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run db:generate` | `drizzle-kit generate` after schema edits |
| `npm run db:migrate` | apply `drizzle/` to `DATABASE_URL` |
| `npm run db:seed` | sample user / repo / pending_fund + funded bounty |
| `npm run test:unit` | fee 2% + 72h helpers + auth env/cookies/paths (no Google, no database) |
| `npm run test:db` | unique indexes + `users.google_sub` upsert (needs `DATABASE_URL`) |
| `npm run build` | Next.js standalone |

## Google Sign-In (V1-2)

Auth.js / NextAuth v5 with the Google provider. Documented in [docs/google-signin.md](../../docs/google-signin.md).

```bash
# apps/web/.env — never commit real values
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
AUTH_SECRET=
```

Redirect URIs to register on the GCP OAuth **Web** client (`experiment-jegf` / `42206083192`):

- `http://localhost:3000/api/auth/callback/google`
- `https://<cloud-run-host>/api/auth/callback/google` (use the real Cloud Run URL; do not invent a host)

`/settings` and `GET /api/me` require a session. **Connect GitHub** is a stub until V1-3.

If Google env is missing, `/signin` lists the unset variable names. Home and `/api/health` still work.

## Out of scope (later tickets)

- Real GitHub App install / `github_links` (V1-3)
- Bounty CRUD / claim-lock UI (V1-4)
- Live CDP / x402 (V1-5)
- Participation-pool accounting beyond nullable columns
