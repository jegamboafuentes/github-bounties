# Shared GitHub Bounties staging constants.
# Sourced by the other scripts in this directory. Not executable on its own.

# Locked project (do not invent a different id).
# Do not use github-bounties / 133702056111 (quota).
PROJECT_ID="experiment-jegf"
PROJECT_NUMBER="42206083192"
# Display name is the human/product lock. Opaque id is what `gcloud billing` uses.
BILLING_ACCOUNT_NAME="LB_MVP1_Billing_account"
BILLING_ACCOUNT_ID="011B0B-3BA3C5-CCE451"

# Hunch: us-central1 is the boring default. Ticket did not lock a region.
# Override with GB_REGION if Ops prefers another.
REGION="${GB_REGION:-us-central1}"

PRODUCT_LABEL="github-bounties"
ENV_LABEL="staging"
LABELS="product=${PRODUCT_LABEL},env=${ENV_LABEL}"

AR_REPO="github-bounties"
AR_FORMAT="docker"
HELLO_SERVICE="github-bounties-hello"
HELLO_IMAGE="github-bounties-hello"

# V1 product (apps/web). Separate Cloud Run service — do not reuse hello.
WEB_SERVICE="github-bounties-web"
WEB_IMAGE="github-bounties-web"
WEB_MEMORY="${GB_WEB_MEMORY:-1Gi}"
WEB_CPU="${GB_WEB_CPU:-1}"
WEB_MAX_INSTANCES="${GB_WEB_MAX_INSTANCES:-2}"

MIGRATE_JOB="github-bounties-migrate"
MIGRATE_IMAGE="github-bounties-migrate"

SQL_INSTANCE="github-bounties-staging"
SQL_TIER="${GB_SQL_TIER:-db-f1-micro}"
SQL_VERSION="POSTGRES_16"
SQL_STORAGE_GB="10"
SQL_DB="github_bounties"
SQL_USER="gb_app"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

RUNTIME_SA_ID="github-bounties-runtime"
BUILD_SA_ID="github-bounties-build"
CI_SA_ID="github-bounties-ci"

RUNTIME_SA="${RUNTIME_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="${BUILD_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
CI_SA="${CI_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

# Secret Manager ids — names only. Values stay out of git.
# Aligns with ADR 0001 for CDP_* and the V0-C ticket list.
# V1-7 adds AUTH_SECRET + GitHub App OAuth client (GITHUB_APP_CLIENT_ID has a version).
SECRETS=(
  DATABASE_URL
  AUTH_SECRET
  GITHUB_APP_PRIVATE_KEY
  GITHUB_WEBHOOK_SECRET
  GITHUB_APP_CLIENT_ID
  GITHUB_APP_CLIENT_SECRET
  CDP_API_KEY_ID
  CDP_API_KEY_SECRET
  CDP_WALLET_SECRET
  CDP_PROJECT_ID
  CDP_CLIENT_API_KEY
  CDP_WEBHOOK_SECRET
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  CRON_SECRET
)

# Cloud Run --set-secrets: required for closed-beta auth + GitHub + DB.
# Deploy fails on --apply if these have no enabled version.
WEB_REQUIRED_SECRETS=(
  DATABASE_URL
  AUTH_SECRET
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  GITHUB_WEBHOOK_SECRET
  GITHUB_APP_PRIVATE_KEY
  GITHUB_APP_CLIENT_ID
  GITHUB_APP_CLIENT_SECRET
)

# Attached when an enabled version exists. Missing CDP_* → mock rail (OK for staging).
# CDP_WEBHOOK_SECRET may stay empty. CRON_SECRET is optional (expire-locks open if unset).
WEB_OPTIONAL_SECRETS=(
  CDP_API_KEY_ID
  CDP_API_KEY_SECRET
  CDP_WALLET_SECRET
  CDP_PROJECT_ID
  CDP_CLIENT_API_KEY
  CDP_WEBHOOK_SECRET
  CRON_SECRET
)
