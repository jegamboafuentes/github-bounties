# Shared GitHub Bounties staging constants.
# Sourced by the other scripts in this directory. Not executable on its own.

# Locked project (do not invent a different id).
# Do not use github-bounties / 133702056111 (quota).
PROJECT_ID="experiment-jegf"
PROJECT_NUMBER="42206083192"
# Billing account display name (product lock). Not the opaque billingAccount IDs.
BILLING_ACCOUNT_NAME="LB_MVP1_Billing_account"

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

SQL_INSTANCE="github-bounties-staging"
SQL_TIER="${GB_SQL_TIER:-db-f1-micro}"
SQL_VERSION="POSTGRES_16"
SQL_STORAGE_GB="10"
SQL_DB="github_bounties"
SQL_USER="gb_app"

RUNTIME_SA_ID="github-bounties-runtime"
BUILD_SA_ID="github-bounties-build"
CI_SA_ID="github-bounties-ci"

RUNTIME_SA="${RUNTIME_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="${BUILD_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
CI_SA="${CI_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

# Secret Manager ids — names only. Values stay out of git.
# Aligns with ADR 0001 for CDP_* and the V0-C ticket list.
SECRETS=(
  DATABASE_URL
  GITHUB_APP_PRIVATE_KEY
  GITHUB_WEBHOOK_SECRET
  CDP_API_KEY_ID
  CDP_API_KEY_SECRET
  CDP_WALLET_SECRET
  CDP_PROJECT_ID
  CDP_CLIENT_API_KEY
  CDP_WEBHOOK_SECRET
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
)
