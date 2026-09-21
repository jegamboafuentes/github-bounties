# Shared Cloud Run web helpers. Sourced by deploy-web.sh and Cloud Build.
# Not executable on its own. Never prints secret values.

# shellcheck source=config.sh
# config.sh must be sourced first.

# First-deploy plain env. AUTH_TRUST_HOST is not in SM (Ops preflight).
# AUTH_URL is a later Secret Manager key — do not set it here.
# GITHUB_APP_ID / GITHUB_APP_SLUG come from SM (--set-secrets), not this list.
web_plain_env_pairs() {
  local pairs=()
  pairs+=("NODE_ENV=production")
  pairs+=("AUTH_TRUST_HOST=true")
  pairs+=("CDP_NETWORK=${CDP_NETWORK:-base-sepolia}")
  # PROD only. Leave unset on DEV/staging so the client + rail stay Sepolia.
  if [[ "${CDP_ALLOW_MAINNET:-}" == "1" || "${CDP_ALLOW_MAINNET:-}" == "true" || "${CDP_ALLOW_MAINNET:-}" == "yes" ]]; then
    pairs+=("CDP_ALLOW_MAINNET=${CDP_ALLOW_MAINNET}")
  fi
  if [[ -n "${PUBLIC_BASE_URL:-}" ]]; then
    pairs+=("PUBLIC_BASE_URL=${PUBLIC_BASE_URL}")
  fi
  # Public Reown / WalletConnect project id (not a secret). QR connect is off if unset.
  if [[ -n "${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}" ]]; then
    pairs+=("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}")
  fi
  local IFS=","
  echo "${pairs[*]}"
}

# True if Secret Manager has at least one enabled version. Prints nothing about values.
secret_has_enabled_version() {
  local name="$1"
  local found
  found="$(gcloud secrets versions list "${name}" \
    --project="${PROJECT_ID}" \
    --filter="state=ENABLED" \
    --limit=1 \
    --format="value(name)" 2>/dev/null || true)"
  [[ -n "${found}" ]]
}

# Optional WEB secrets (GEMINI_API_KEY): attach when SM has an enabled version.
# Skip cleanly when absent. Not gated on GB_ATTACH_OPTIONAL_SECRETS (that's the
# skip-list: CRON / CDP_WEBHOOK / AUTH_URL). Never prints values.
append_optional_web_secrets() {
  local -n _pairs=$1
  local name
  for name in "${WEB_OPTIONAL_SECRETS[@]}"; do
    if secret_has_enabled_version "${name}"; then
      _pairs+=("${name}=${name}:latest")
    fi
  done
}

# First-deploy static map (Cloud Build). Required + CDP. Never AUTH_URL / CRON / CDP_WEBHOOK.
# Optional WEB secrets (GEMINI) attach only when an enabled version exists.
web_static_set_secrets_csv() {
  local pairs=()
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}" "${WEB_CDP_SECRETS[@]}"; do
    pairs+=("${name}=${name}:latest")
  done
  if [[ "${GB_ATTACH_OPTIONAL_SECRETS:-}" == "1" ]]; then
    for name in "${WEB_SKIP_SECRETS[@]}"; do
      pairs+=("${name}=${name}:latest")
    done
  fi
  append_optional_web_secrets pairs
  local IFS=","
  echo "${pairs[*]}"
}

# Discover: bind names that have versions, except skip-list (0 versions / not yet).
# Optional WEB secrets attach when present, independent of GB_ATTACH_OPTIONAL_SECRETS.
web_set_secrets_csv() {
  local pairs=()
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}" "${WEB_CDP_SECRETS[@]}"; do
    if secret_has_enabled_version "${name}"; then
      pairs+=("${name}=${name}:latest")
    fi
  done
  if [[ "${GB_ATTACH_OPTIONAL_SECRETS:-}" == "1" ]]; then
    for name in "${WEB_SKIP_SECRETS[@]}"; do
      if secret_has_enabled_version "${name}"; then
        pairs+=("${name}=${name}:latest")
      fi
    done
  fi
  append_optional_web_secrets pairs
  local IFS=","
  echo "${pairs[*]}"
}

web_missing_required_secrets() {
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}" "${WEB_CDP_SECRETS[@]}"; do
    if ! secret_has_enabled_version "${name}"; then
      echo "${name}"
    fi
  done
}

web_print_secret_map() {
  echo "Web runtime secret map (names only — values stay in Secret Manager):"
  echo
  echo "  First-deploy --set-secrets (Ops: enabled versions present):"
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}"; do
    echo "    ${name} -> ${name}"
  done
  echo
  echo "  First-deploy CDP (Ops: enabled versions present):"
  for name in "${WEB_CDP_SECRETS[@]}"; do
    echo "    ${name} -> ${name}"
  done
  echo
  echo "  Optional WEB (attach ENV=NAME:latest when an enabled SM version exists;"
  echo "  skip cleanly when absent — not required, not PROD):"
  for name in "${WEB_OPTIONAL_SECRETS[@]}"; do
    echo "    ${name} -> ${name}"
  done
  echo
  echo "  Do not attach on first deploy (GB_ATTACH_OPTIONAL_SECRETS=1 to bind if present):"
  echo "    CDP_WEBHOOK_SECRET  (resource exists, enabled_versions=0)"
  echo "    CRON_SECRET         (not in SM; expire-locks open for smoke)"
  echo "    AUTH_URL            (create after live Cloud Run origin)"
  echo
  echo "  Plain env (not secrets):"
  echo "    AUTH_TRUST_HOST=true, CDP_NETWORK=base-sepolia, NODE_ENV=production"
  echo "    CDP_ALLOW_MAINNET only if exported (PROD). Leave unset on DEV."
  echo "    PORT=8080 (Cloud Run). PUBLIC_BASE_URL optional after live origin."
  echo "    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID  (optional; Reown Cloud project id,"
  echo "      not SM. Export before deploy-web.sh so WalletConnect QR works on DEV.)"
}
