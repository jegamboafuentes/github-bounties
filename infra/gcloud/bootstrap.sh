#!/usr/bin/env bash
# Staging baseline: APIs, labels, Artifact Registry, empty secrets, least-privilege SAs.
# Default is dry-run (prints commands). Pass --apply to execute.
# Requires: authenticated gcloud + billing on github-bounties. See preflight.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

echo "GitHub Bounties — GCP bootstrap (${PROJECT_ID} / ${PROJECT_NUMBER})"
echo "Region: ${REGION}"
if [[ "${APPLY}" -eq 0 ]]; then
  echo "Mode: DRY-RUN (pass --apply to execute)"
fi
echo

if [[ "${APPLY}" -eq 1 ]]; then
  "${ROOT}/preflight.sh"
fi

APIS=(
  run.googleapis.com
  sqladmin.googleapis.com
  secretmanager.googleapis.com
  cloudbuild.googleapis.com
  artifactregistry.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  cloudresourcemanager.googleapis.com
  compute.googleapis.com
  servicenetworking.googleapis.com
  vpcaccess.googleapis.com
  logging.googleapis.com
  monitoring.googleapis.com
  serviceusage.googleapis.com
  sts.googleapis.com
)

run gcloud config set project "${PROJECT_ID}"

echo
echo "# APIs"
run gcloud services enable "${APIS[@]}" --project="${PROJECT_ID}"

echo
echo "# Project labels"
run gcloud projects update "${PROJECT_ID}" --update-labels="${LABELS}"

echo
echo "# Artifact Registry (${AR_FORMAT} / ${REGION} / ${AR_REPO})"
run gcloud artifacts repositories create "${AR_REPO}" \
  --repository-format="${AR_FORMAT}" \
  --location="${REGION}" \
  --description="GitHub Bounties container images (staging)" \
  --labels="${LABELS}" \
  --project="${PROJECT_ID}" || true

echo
echo "# Secret Manager — names only, no versions/values"
for name in "${SECRETS[@]}"; do
  run gcloud secrets create "${name}" \
    --replication-policy=automatic \
    --labels="${LABELS}" \
    --project="${PROJECT_ID}" || true
done

echo
echo "# Service accounts"
for sa_id in "${RUNTIME_SA_ID}" "${BUILD_SA_ID}" "${CI_SA_ID}"; do
  run gcloud iam service-accounts create "${sa_id}" \
    --display-name="GitHub Bounties ${sa_id}" \
    --project="${PROJECT_ID}" || true
done

echo
echo "# IAM — runtime"
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudsql.client" \
  --condition=None
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/logging.logWriter" \
  --condition=None

echo
echo "# IAM — build"
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/run.developer" \
  --condition=None
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/logging.logWriter" \
  --condition=None
run gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT_ID}"

echo
echo "# IAM — CI (same deploy shape as build; bind GitHub via WIF later — no JSON keys)"
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CI_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CI_SA}" \
  --role="roles/run.developer" \
  --condition=None
run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CI_SA}" \
  --role="roles/cloudbuild.builds.editor" \
  --condition=None
run gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${CI_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT_ID}"

echo
echo "# Next (not in this script): infra/gcloud/sql-staging.sh then deploy-hello.sh"
if [[ "${APPLY}" -eq 0 ]]; then
  echo "Dry-run finished. Re-run with --apply after preflight.sh exits 0."
fi
