#!/usr/bin/env bash
# Print Secret Manager names and whether an enabled version exists.
# Never prints secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "${ROOT}/config.sh"
# shellcheck source=web-runtime.sh
source "${ROOT}/web-runtime.sh"

echo "GitHub Bounties — Secret Manager version check (${PROJECT_ID})"
echo "Values are never printed."
echo

if ! command -v gcloud >/dev/null 2>&1; then
  echo "BLOCKED: gcloud CLI is not installed." >&2
  exit 2
fi

printf "%-32s %-14s %s\n" "NAME" "FIRST_DEPLOY" "ENABLED_VERSION"
printf "%-32s %-14s %s\n" "----" "------------" "---------------"

first_set=" ${WEB_REQUIRED_SECRETS[*]} ${WEB_CDP_SECRETS[*]} "
for name in "${SECRETS[@]}"; do
  slot="skip"
  if [[ "${first_set}" == *" ${name} "* ]]; then
    slot="yes"
  fi
  if secret_has_enabled_version "${name}"; then
    printf "%-32s %-14s %s\n" "${name}" "${slot}" "yes"
  else
    printf "%-32s %-14s %s\n" "${name}" "${slot}" "no"
  fi
done

echo
echo "Add a version (stdin, never git):"
echo "  gcloud secrets versions add NAME --data-file=- --project=${PROJECT_ID}"
