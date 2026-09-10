#!/usr/bin/env bash
# CI / local: V1-7 wiring sanity. No gcloud, no secrets, no live GCP.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "Checking hello canary Cloud Build is unchanged..."
grep -q "dir: services/hello" cloudbuild.yaml || fail "cloudbuild.yaml must build services/hello"
grep -q "_SERVICE: github-bounties-hello" cloudbuild.yaml || fail "cloudbuild.yaml service must stay github-bounties-hello"
grep -q "github-bounties-web" cloudbuild.yaml && fail "cloudbuild.yaml must not mention github-bounties-web"

echo "Checking web Cloud Build..."
grep -q "dir: apps/web" cloudbuild.web.yaml || fail "cloudbuild.web.yaml must build apps/web"
grep -q "_SERVICE: github-bounties-web" cloudbuild.web.yaml || fail "cloudbuild.web.yaml service must be github-bounties-web"
grep -q "infra/gcloud/deploy-web.sh" cloudbuild.web.yaml || fail "cloudbuild.web.yaml must call deploy-web.sh"
grep -q "services/hello" cloudbuild.web.yaml && fail "cloudbuild.web.yaml must not build services/hello"

echo "Checking Dockerfiles..."
[[ -f apps/web/Dockerfile ]] || fail "missing apps/web/Dockerfile"
[[ -f apps/web/Dockerfile.migrate ]] || fail "missing apps/web/Dockerfile.migrate"
grep -q "PORT=8080" apps/web/Dockerfile || fail "web Dockerfile must set PORT=8080"
grep -q "migrate.ts" apps/web/Dockerfile.migrate || fail "migrate Dockerfile must run drizzle migrate"

echo "Checking scripts parse..."
for script in \
  infra/gcloud/deploy-hello.sh \
  infra/gcloud/deploy-web.sh \
  infra/gcloud/migrate-staging.sh \
  infra/gcloud/list-secret-versions.sh \
  infra/gcloud/bootstrap.sh \
  infra/gcloud/sql-staging.sh \
  infra/gcloud/preflight.sh
do
  bash -n "${script}"
done

echo "Dry-run web deploy + migrate (no gcloud required)..."
infra/gcloud/deploy-web.sh >/tmp/gb-deploy-web-dry.txt
grep -q "github-bounties-web" /tmp/gb-deploy-web-dry.txt || fail "deploy-web dry-run must mention web service"
grep -q "github-bounties-hello" /tmp/gb-deploy-web-dry.txt || fail "deploy-web dry-run must remind hello is separate"
grep -q "DATABASE_URL" /tmp/gb-deploy-web-dry.txt || fail "deploy-web dry-run must list DATABASE_URL name"
grep -q "AUTH_TRUST_HOST=true" /tmp/gb-deploy-web-dry.txt || fail "first deploy must set AUTH_TRUST_HOST=true as plain env"
grep -q "set-cloudsql-instances" /tmp/gb-deploy-web-dry.txt || fail "deploy-web must use --set-cloudsql-instances"
SET_LINE="$(tr ' ' '\n' </tmp/gb-deploy-web-dry.txt | grep '^--set-secrets=' || true)"
[[ -n "${SET_LINE}" ]] || fail "deploy-web dry-run must print --set-secrets"
echo "${SET_LINE}" | grep -q "GITHUB_APP_ID=GITHUB_APP_ID:latest" || fail "first-deploy secrets must include GITHUB_APP_ID"
echo "${SET_LINE}" | grep -q "GITHUB_APP_SLUG=GITHUB_APP_SLUG:latest" || fail "first-deploy secrets must include GITHUB_APP_SLUG"
echo "${SET_LINE}" | grep -q "CDP_API_KEY_ID=CDP_API_KEY_ID:latest" || fail "first-deploy secrets must include CDP_API_KEY_ID"
echo "${SET_LINE}" | grep -q "CDP_WEBHOOK_SECRET" && fail "first-deploy --set-secrets must not bind CDP_WEBHOOK_SECRET"
echo "${SET_LINE}" | grep -q "CRON_SECRET" && fail "first-deploy --set-secrets must not bind CRON_SECRET"
echo "${SET_LINE}" | grep -q "AUTH_URL" && fail "first-deploy --set-secrets must not bind AUTH_URL"

infra/gcloud/migrate-staging.sh >/tmp/gb-migrate-dry.txt
grep -q "DATABASE_URL" /tmp/gb-migrate-dry.txt || fail "migrate dry-run must mention DATABASE_URL name"
grep -qE "password|postgresql://gb_app:" /tmp/gb-migrate-dry.txt && fail "migrate dry-run leaked a URL/password"

infra/gcloud/migrate-staging.sh --job >/tmp/gb-migrate-job-dry.txt
grep -q "github-bounties-migrate" /tmp/gb-migrate-job-dry.txt || fail "migrate --job dry-run must mention the job"

infra/gcloud/deploy-hello.sh >/tmp/gb-deploy-hello-dry.txt
grep -q "github-bounties-hello" /tmp/gb-deploy-hello-dry.txt || fail "hello dry-run must mention hello service"
grep -q "github-bounties-web" /tmp/gb-deploy-hello-dry.txt && fail "hello dry-run must not deploy web"

echo "Checking docs..."
[[ -f docs/staging-deploy.md ]] || fail "missing docs/staging-deploy.md"
[[ -f docs/staging-e2e.md ]] || fail "missing docs/staging-e2e.md"

echo "OK: V1-7 staging wiring"
