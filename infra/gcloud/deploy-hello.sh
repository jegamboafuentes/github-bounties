#!/usr/bin/env bash
# Build the hello image locally (or via Cloud Build) and deploy to Cloud Run.
# Default dry-run; pass --apply to execute. Will fail here without gcloud + billing + AR.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${ROOT}/../.." && pwd)"
# shellcheck source=config.sh
source "${ROOT}/config.sh"

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
fi

run() {
  echo "+ $*"
  if [[ "${APPLY}" -eq 1 ]]; then
    "$@"
  fi
}

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${HELLO_IMAGE}:staging"

echo "GitHub Bounties — Cloud Run hello"
echo "Service: ${HELLO_SERVICE}"
echo "Image:   ${IMAGE}"
echo "Health:  GET / and GET /api/health → 200"
echo

run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
run docker build -t "${IMAGE}" -f "${REPO_ROOT}/services/hello/Dockerfile" "${REPO_ROOT}/services/hello"
run docker push "${IMAGE}"

run gcloud run deploy "${HELLO_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --service-account="${RUNTIME_SA}" \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --max-instances=2 \
  --allow-unauthenticated \
  --labels="${LABELS}"

echo
echo "Live URL (only after a successful deploy):"
echo "  gcloud run services describe ${HELLO_SERVICE} --region=${REGION} --format='value(status.url)'"
echo "Do not invent a *.run.app URL if deploy did not happen."
