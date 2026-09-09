#!/usr/bin/env bash
# Staging Cloud SQL Postgres. Default dry-run; pass --apply to execute.
#
# Preferred: private IP once a VPC + Private Service Connect range exists.
# Interim: public IP + require SSL + Cloud SQL Auth Proxy / Cloud Run connector.
# Does not print or write DATABASE_URL. Set the secret out-of-band.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "${ROOT}/config.sh"

APPLY=0
NETWORK_MODE="${GB_SQL_NETWORK:-interim-public-ssl}"
for arg in "$@"; do
  case "${arg}" in
    --apply) APPLY=1 ;;
    --private) NETWORK_MODE="private" ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 2
      ;;
  esac
done

run() {
  echo "+ $*"
  if [[ "${APPLY}" -eq 1 ]]; then
    "$@"
  fi
}

echo "GitHub Bounties — Cloud SQL staging (${SQL_INSTANCE})"
echo "Tier: ${SQL_TIER}  Edition: ENTERPRISE  Version: ${SQL_VERSION}  Mode: ${NETWORK_MODE}"
echo "DATABASE_URL is not generated here. Create a password locally and add a secret version."
echo

# Pin Enterprise (not Plus). SDK 584+ defaults create to ENTERPRISE_PLUS,
# which rejects shared-core db-f1-micro. gcloud accepts ENTERPRISE / enterprise.
COMMON=(
  --project="${PROJECT_ID}"
  --database-version="${SQL_VERSION}"
  --tier="${SQL_TIER}"
  --edition=ENTERPRISE
  --region="${REGION}"
  --storage-size="${SQL_STORAGE_GB}"
  --storage-type=SSD
  --availability-type=ZONAL
  --backup-start-time=09:00
  --maintenance-window-day=SUN
  --maintenance-window-hour=8
  --database-flags=cloudsql.iam_authentication=on
)

if [[ "${NETWORK_MODE}" == "private" ]]; then
  VPC="${GB_VPC:-default}"
  echo "Private IP on VPC ${VPC}. Requires allocated PSA range + servicenetworking peering."
  echo "If that peering is missing, this create will fail — use interim-public-ssl."
  run gcloud sql instances create "${SQL_INSTANCE}" \
    "${COMMON[@]}" \
    --network="${VPC}" \
    --no-assign-ip \
    --require-ssl
else
  echo "Interim: public IP + --require-ssl. Prefer Cloud SQL Auth Proxy; do not expose 5432 to 0.0.0.0/0."
  run gcloud sql instances create "${SQL_INSTANCE}" \
    "${COMMON[@]}" \
    --assign-ip \
    --require-ssl
  echo
  echo "# After create, authorize only the proxy/Run connector — not the public internet:"
  echo "# gcloud sql instances patch ${SQL_INSTANCE} --authorized-networks=YOUR_BASTION_CIDR"
fi

run gcloud sql databases create "${SQL_DB}" \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT_ID}"

echo
echo "Create the app user and DATABASE_URL yourself (do not put the password in git or shell history if you can avoid it):"
echo "  gcloud sql users create ${SQL_USER} --instance=${SQL_INSTANCE} --project=${PROJECT_ID}"
echo "  # unix-socket (Cloud Run --set-cloudsql-instances):"
echo "  # postgresql://${SQL_USER}:PASSWORD@/${SQL_DB}?host=/cloudsql/${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
echo "  echo -n 'postgresql://...' | gcloud secrets versions add DATABASE_URL --data-file=- --project=${PROJECT_ID}"
echo
echo "Reachability from Cloud Run:"
echo "  private IP → Serverless VPC Access or Direct VPC egress on the same VPC"
echo "  interim public → Cloud Run Cloud SQL connection (unix socket) + require SSL"
