#!/usr/bin/env bash
# Build apps/web (or reuse a Cloud Build image) and deploy github-bounties-web.
# Default dry-run; pass --apply to execute. Does not touch github-bounties-hello.
# Never prints secret values. --allow-unauthenticated is for browser + GitHub webhooks;
# org DRS may still 403 allUsers (use authenticated curl / grant run.invoker to testers).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${ROOT}/../.." && pwd)"
# shellcheck source=config.sh
source "${ROOT}/config.sh"
# shellcheck source=web-runtime.sh
source "${ROOT}/web-runtime.sh"

APPLY=0
IMAGE_OVERRIDE=""
SKIP_BUILD=0
SECRETS_MODE="discover"

usage() {
  cat <<EOF
Usage: $0 [--apply] [--image IMAGE] [--skip-build] [--secrets discover|static]

  --apply       Execute gcloud/docker (default is dry-run)
  --image       Deploy this image (skip local docker build/push)
  --skip-build  Same as --image using the :staging tag already in AR
  --secrets     discover (default, laptop): attach SM names that have versions
                static (Cloud Build): attach WEB_REQUIRED_SECRETS without listing

Env (plain, not secrets):
  GITHUB_APP_ID, GITHUB_APP_SLUG, PUBLIC_BASE_URL
  GB_REGION, GB_WEB_MEMORY, GB_WEB_CPU, GB_WEB_MAX_INSTANCES, CDP_NETWORK
  GB_ATTACH_OPTIONAL_SECRETS=1  (static mode: also bind WEB_OPTIONAL_SECRETS)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --image)
      IMAGE_OVERRIDE="${2:-}"
      SKIP_BUILD=1
      shift
      ;;
    --skip-build) SKIP_BUILD=1 ;;
    --secrets)
      SECRETS_MODE="${2:-}"
      shift
      ;;
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

if [[ "${SECRETS_MODE}" != "discover" && "${SECRETS_MODE}" != "static" ]]; then
  echo "unknown --secrets mode: ${SECRETS_MODE}" >&2
  exit 2
fi

run() {
  echo "+ $*"
  if [[ "${APPLY}" -eq 1 ]]; then
    "$@"
  fi
}

IMAGE="${IMAGE_OVERRIDE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${WEB_IMAGE}:staging}"
ENV_PAIRS="$(web_plain_env_pairs)"

echo "GitHub Bounties — Cloud Run web (V1 product)"
echo "Service: ${WEB_SERVICE}"
echo "Image:   ${IMAGE}"
echo "SQL:     ${SQL_CONNECTION}"
echo "Health:  GET /api/health → 200 (hello canary is unchanged)"
echo
if [[ "${APPLY}" -eq 0 ]]; then
  echo "Mode: DRY-RUN (pass --apply to execute)"
  echo
fi
web_print_secret_map
echo

SET_SECRETS=""
if [[ "${SECRETS_MODE}" == "static" ]]; then
  SET_SECRETS="$(web_static_set_secrets_csv)"
  echo "Secret mode: static (required names; optional only if GB_ATTACH_OPTIONAL_SECRETS=1)."
elif [[ "${APPLY}" -eq 1 ]]; then
  missing="$(web_missing_required_secrets || true)"
  if [[ -n "${missing}" ]]; then
    echo "BLOCKED: required secrets have no enabled version (names only):" >&2
    echo "${missing}" | sed 's/^/  - /' >&2
    echo "Add a version with: gcloud secrets versions add NAME --data-file=- --project=${PROJECT_ID}" >&2
    echo "Never paste values into git, chat, or this log." >&2
    exit 2
  fi
  SET_SECRETS="$(web_set_secrets_csv)"
  echo "Attaching Secret Manager refs that have enabled versions (names only)."
else
  echo "Would attach --set-secrets for required names that have versions,"
  echo "plus optional CDP_*/CRON_SECRET when a version exists."
  echo "Cloud Build uses --secrets=static (no versions.list)."
fi
echo

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  run docker build -t "${IMAGE}" -f "${REPO_ROOT}/apps/web/Dockerfile" "${REPO_ROOT}/apps/web"
  run docker push "${IMAGE}"
else
  echo "Skipping local docker build (using ${IMAGE})"
  echo
fi

DEPLOY_ARGS=(
  gcloud run deploy "${WEB_SERVICE}"
  --project="${PROJECT_ID}"
  --region="${REGION}"
  --image="${IMAGE}"
  --service-account="${RUNTIME_SA}"
  --port=8080
  --memory="${WEB_MEMORY}"
  --cpu="${WEB_CPU}"
  --max-instances="${WEB_MAX_INSTANCES}"
  --add-cloudsql-instances="${SQL_CONNECTION}"
  --set-env-vars="${ENV_PAIRS}"
  --allow-unauthenticated
  --labels="${LABELS}"
)

if [[ -z "${SET_SECRETS}" && "${APPLY}" -eq 0 ]]; then
  SET_SECRETS="$(web_static_set_secrets_csv)"
fi
if [[ -n "${SET_SECRETS}" ]]; then
  DEPLOY_ARGS+=(--set-secrets="${SET_SECRETS}")
fi

run "${DEPLOY_ARGS[@]}"

echo
echo "Live URL (only after a successful deploy — do not invent a *.run.app host):"
echo "  gcloud run services describe ${WEB_SERVICE} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)'"
echo
echo "Then set PUBLIC_BASE_URL/AUTH_URL to that origin and redeploy or:"
echo "  gcloud run services update ${WEB_SERVICE} --project=${PROJECT_ID} --region=${REGION} \\"
echo "    --update-env-vars=PUBLIC_BASE_URL=\$URL,AUTH_URL=\$URL"
echo
echo "Health smoke (DRS may 403 unauthenticated GET):"
echo "  curl -sS -H \"Authorization: Bearer \$(gcloud auth print-identity-token)\" \"\$URL/api/health\""
echo
echo "Hello canary is a different service (${HELLO_SERVICE}). This script does not deploy it."
