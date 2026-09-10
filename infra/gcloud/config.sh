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
# Ops preflight 2026-09-10: enabled versions exist for the first-deploy lists
# below. CDP_WEBHOOK_SECRET exists but enabled_versions=0. CRON_SECRET, AUTH_URL,
# AUTH_TRUST_HOST are not in SM (AUTH_TRUST_HOST is plain env; AUTH_URL after URL).
SECRETS=(
  DATABASE_URL
  AUTH_SECRET
  AUTH_URL
  GITHUB_APP_ID
  GITHUB_APP_SLUG
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

# First-deploy --set-secrets (Ops: enabled versions present).
WEB_REQUIRED_SECRETS=(
  DATABASE_URL
  AUTH_SECRET
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  GITHUB_APP_ID
  GITHUB_APP_SLUG
  GITHUB_WEBHOOK_SECRET
  GITHUB_APP_PRIVATE_KEY
  GITHUB_APP_CLIENT_ID
  GITHUB_APP_CLIENT_SECRET
)

# First-deploy CDP (Ops: enabled versions present). Sepolia live rail.
WEB_CDP_SECRETS=(
  CDP_API_KEY_ID
  CDP_API_KEY_SECRET
  CDP_WALLET_SECRET
  CDP_PROJECT_ID
  CDP_CLIENT_API_KEY
)

# Do not attach on first deploy.
# CDP_WEBHOOK_SECRET: resource exists, enabled_versions=0 (deploy fails if bound).
# CRON_SECRET: not in SM — expire-locks stays open for smoke.
# AUTH_URL: create after the live Cloud Run origin is known.
WEB_SKIP_SECRETS=(
  CDP_WEBHOOK_SECRET
  CRON_SECRET
  AUTH_URL
)
