#!/usr/bin/env bash
# Report exact GCP bootstrap blockers. Read-only. Never prints secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "${ROOT}/config.sh"

echo "GitHub Bounties — V0-C GCP preflight"
echo "Project id:     ${PROJECT_ID}"
echo "Project number: ${PROJECT_NUMBER}"
echo "Billing:        ${BILLING_ACCOUNT_NAME}"
echo "Region:         ${REGION}"
echo

blockers=()

if ! command -v gcloud >/dev/null 2>&1; then
  blockers+=("gcloud CLI is not installed (command not found)")
else
  echo "gcloud: $(command -v gcloud)"
  gcloud version 2>/dev/null | head -n 3 || true
  echo
  active="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
  if [[ -z "${active}" ]]; then
    blockers+=("gcloud auth: no active account (run gcloud auth login / application-default login)")
  else
    echo "active account: ${active}"
  fi
  if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
    blockers+=("cannot describe project ${PROJECT_ID} (missing IAM or wrong account)")
  fi
  billing="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingAccountName)' 2>/dev/null || true)"
  enabled="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
  if [[ -z "${billing}" || "${enabled}" != "True" ]]; then
    blockers+=("billing not attached or not readable (expect ${BILLING_ACCOUNT_NAME})")
  else
    echo "billing account: ${billing}"
  fi
fi

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]] && [[ ! -f "${HOME}/.config/gcloud/application_default_credentials.json" ]]; then
  blockers+=("no Application Default Credentials (ADC) on this machine")
fi

if [[ ${#blockers[@]} -eq 0 ]]; then
  echo "PREFLIGHT OK — gcloud can see ${PROJECT_ID}."
  exit 0
fi

echo "BLOCKED: live GCP bootstrap cannot run from this environment."
echo "Exact blockers:"
for b in "${blockers[@]}"; do
  echo "  - ${b}"
done
echo
echo "Do not invent Cloud Run / SQL URLs until the above are cleared."
echo "Docs: docs/gcp-bootstrap.md"
exit 2
