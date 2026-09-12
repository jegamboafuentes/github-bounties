#!/usr/bin/env bash
# Apply Drizzle migrations to Cloud SQL using Secret Manager DATABASE_URL.
# Never echoes the URL or any other secret value.
#
# Paths:
#   (default) Cloud SQL Auth Proxy on localhost + apps/web `npm run db:migrate`
#   --job     Cloud Run Job one-shot (unix-socket DATABASE_URL, no laptop proxy)
#
# Secret Manager DATABASE_URL may be empty-host (`@/db?host=/cloudsql/…`) or
# the Cloud Run source shape (`@localhost/db?host=/cloudsql/…`). The proxy
# helper accepts both; it strips `host=` (not a PG GUC) and sets sslmode=disable.
#
# Default dry-run. Pass --apply to execute.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${ROOT}/../.." && pwd)"
# shellcheck source=config.sh
source "${ROOT}/config.sh"

APPLY=0
MODE="proxy"
PROXY_PORT="${GB_PROXY_PORT:-5432}"

usage() {
  cat <<EOF
Usage: $0 [--apply] [--proxy|--job]

  --apply   Execute (default is dry-run)
  --proxy   Laptop path: Cloud SQL Auth Proxy + local drizzle migrate (default)
  --job     Build/run Cloud Run Job github-bounties-migrate (one-shot)

Never prints DATABASE_URL. Access it only via Secret Manager; this script
unsets the variable when it finishes.

Requires (proxy path): gcloud, cloud-sql-proxy (or cloud_sql_proxy), Node 22,
  apps/web dependencies (npm ci).
Requires (job path): gcloud, docker (to build the migrate image) on --apply.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --proxy) MODE="proxy" ;;
    --job) MODE="job" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

run() {
  echo "+ $*"
  if [[ "${APPLY}" -eq 1 ]]; then
    "$@"
  fi
}

echo "GitHub Bounties — Cloud SQL migrate (${MODE})"
echo "Project:  ${PROJECT_ID}"
echo "Instance: ${SQL_INSTANCE} (${SQL_CONNECTION})"
echo "Secret:   DATABASE_URL (value never printed)"
echo
if [[ "${APPLY}" -eq 0 ]]; then
  echo "Mode: DRY-RUN (pass --apply to execute)"
  echo
fi

if [[ "${MODE}" == "job" ]]; then
  MIGRATE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${MIGRATE_IMAGE}:staging"
  echo "Cloud Run Job path (unix-socket DATABASE_URL from Secret Manager):"
  echo
  run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  run docker build \
    -t "${MIGRATE_TAG}" \
    -f "${REPO_ROOT}/apps/web/Dockerfile.migrate" \
    "${REPO_ROOT}/apps/web"
  run docker push "${MIGRATE_TAG}"
  echo
  echo "+ gcloud run jobs describe ${MIGRATE_JOB} || gcloud run jobs create ..."
  if [[ "${APPLY}" -eq 1 ]]; then
    if gcloud run jobs describe "${MIGRATE_JOB}" --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
      gcloud run jobs update "${MIGRATE_JOB}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --image="${MIGRATE_TAG}" \
        --service-account="${RUNTIME_SA}" \
        --set-cloudsql-instances="${SQL_CONNECTION}" \
        --set-secrets="DATABASE_URL=DATABASE_URL:latest" \
        --memory=512Mi \
        --cpu=1 \
        --task-timeout=10m \
        --max-retries=1 \
        --labels="${LABELS}"
    else
      gcloud run jobs create "${MIGRATE_JOB}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --image="${MIGRATE_TAG}" \
        --service-account="${RUNTIME_SA}" \
        --set-cloudsql-instances="${SQL_CONNECTION}" \
        --set-secrets="DATABASE_URL=DATABASE_URL:latest" \
        --memory=512Mi \
        --cpu=1 \
        --task-timeout=10m \
        --max-retries=1 \
        --labels="${LABELS}"
    fi
    gcloud run jobs execute "${MIGRATE_JOB}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --wait
  else
    echo "+ gcloud run jobs create|update ${MIGRATE_JOB} --set-secrets=DATABASE_URL=DATABASE_URL:latest --set-cloudsql-instances=${SQL_CONNECTION}"
    echo "+ gcloud run jobs execute ${MIGRATE_JOB} --region=${REGION} --wait"
  fi
  echo
  echo "Job logs (no secret values):"
  echo "  gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=${MIGRATE_JOB}' --project=${PROJECT_ID} --limit=50"
  exit 0
fi

echo "Auth Proxy path:"
echo "  1. Start cloud-sql-proxy ${SQL_CONNECTION} --port=${PROXY_PORT}"
echo "  2. gcloud secrets versions access latest --secret=DATABASE_URL (captured, not printed)"
echo "  3. Rewrite empty-host / @localhost?host=/cloudsql URLs to 127.0.0.1:${PROXY_PORT} (strip host=, sslmode=disable; never echoed)"
echo "  4. cd apps/web && npm run db:migrate"
echo "  5. unset DATABASE_URL"
echo

if [[ "${APPLY}" -eq 0 ]]; then
  echo "Install proxy (pick one, if needed):"
  echo "  https://cloud.google.com/sql/docs/postgres/sql-proxy"
  echo "  gcloud components install cloud-sql-proxy"
  echo
  echo "Do not seed staging unless Ops explicitly wants fixture rows (db:seed is for empty/dev DBs)."
  exit 0
fi

PROXY_BIN=""
if command -v cloud-sql-proxy >/dev/null 2>&1; then
  PROXY_BIN="cloud-sql-proxy"
elif command -v cloud_sql_proxy >/dev/null 2>&1; then
  PROXY_BIN="cloud_sql_proxy"
else
  echo "BLOCKED: cloud-sql-proxy not on PATH. Install it, or use $0 --apply --job" >&2
  exit 2
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "BLOCKED: gcloud CLI is required to access Secret Manager DATABASE_URL" >&2
  exit 2
fi

if [[ ! -d "${REPO_ROOT}/apps/web/node_modules" ]]; then
  echo "Installing apps/web dependencies (needed for drizzle migrate)..."
  (cd "${REPO_ROOT}/apps/web" && npm ci)
fi

PROXY_LOG="$(mktemp)"
cleanup() {
  unset DATABASE_URL || true
  if [[ -n "${PROXY_PID:-}" ]] && kill -0 "${PROXY_PID}" 2>/dev/null; then
    kill "${PROXY_PID}" 2>/dev/null || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  rm -f "${PROXY_LOG}"
}
trap cleanup EXIT

echo "Starting ${PROXY_BIN} (logs: ${PROXY_LOG}, no URLs printed)..."
if [[ "${PROXY_BIN}" == "cloud-sql-proxy" ]]; then
  "${PROXY_BIN}" "${SQL_CONNECTION}" --port="${PROXY_PORT}" >"${PROXY_LOG}" 2>&1 &
else
  "${PROXY_BIN}" --port="${PROXY_PORT}" "${SQL_CONNECTION}" >"${PROXY_LOG}" 2>&1 &
fi
PROXY_PID=$!

ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
    echo "BLOCKED: cloud-sql-proxy exited. Check ${PROXY_LOG} (should not contain DATABASE_URL)." >&2
    exit 2
  fi
  if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "${PROXY_PORT}" 2>/dev/null; then
    ready=1
    break
  fi
  # Fallback: proxy prints "ready for new connections" without secrets.
  if grep -qiE "ready for new connections|listening" "${PROXY_LOG}" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done

if [[ "${ready}" -ne 1 ]]; then
  echo "BLOCKED: proxy did not become ready on 127.0.0.1:${PROXY_PORT}" >&2
  exit 2
fi

# Capture only. Do not echo, do not set -x, do not pass through `run`.
DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project="${PROJECT_ID}")"
export DATABASE_URL
export GB_PROXY_LISTEN="127.0.0.1:${PROXY_PORT}"

echo "Running drizzle migrate (DATABASE_URL is set in the process only)..."
(
  cd "${REPO_ROOT}/apps/web"
  node "${ROOT}/proxy-database-url.mjs" --exec npm run db:migrate
)
unset DATABASE_URL

echo "Migrations applied. DATABASE_URL unset in this shell."
echo "Optional (empty/dev DBs only, not a default staging step):"
echo "  # export DATABASE_URL from SM in a throwaway shell, then:"
echo "  # cd apps/web && node ${ROOT}/proxy-database-url.mjs --exec npm run db:seed"
echo "  # unset DATABASE_URL"
