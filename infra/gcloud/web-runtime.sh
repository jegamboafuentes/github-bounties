# Shared Cloud Run web helpers. Sourced by deploy-web.sh and Cloud Build.
# Not executable on its own. Never prints secret values.

# shellcheck source=config.sh
# config.sh must be sourced first.

# Non-secret runtime flags. GITHUB_APP_ID / GITHUB_APP_SLUG are identifiers, not SM.
# PUBLIC_BASE_URL / AUTH_URL are set after the first live URL is known.
web_plain_env_pairs() {
  local pairs=()
  pairs+=("NODE_ENV=production")
  pairs+=("CDP_NETWORK=${CDP_NETWORK:-base-sepolia}")
  if [[ -n "${GITHUB_APP_ID:-}" ]]; then
    pairs+=("GITHUB_APP_ID=${GITHUB_APP_ID}")
  fi
  if [[ -n "${GITHUB_APP_SLUG:-}" ]]; then
    pairs+=("GITHUB_APP_SLUG=${GITHUB_APP_SLUG}")
  fi
  if [[ -n "${PUBLIC_BASE_URL:-}" ]]; then
    pairs+=("PUBLIC_BASE_URL=${PUBLIC_BASE_URL}")
    pairs+=("AUTH_URL=${PUBLIC_BASE_URL}")
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

# Static map for Cloud Build (no versions.list). Required always; optional if flagged.
web_static_set_secrets_csv() {
  local pairs=()
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}"; do
    pairs+=("${name}=${name}:latest")
  done
  if [[ "${GB_ATTACH_OPTIONAL_SECRETS:-}" == "1" ]]; then
    for name in "${WEB_OPTIONAL_SECRETS[@]}"; do
      pairs+=("${name}=${name}:latest")
    done
  fi
  local IFS=","
  echo "${pairs[*]}"
}

# Print ENV=SECRET:latest,ENV=SECRET:latest for secrets that have versions.
# Names only. Empty stdout if none.
web_set_secrets_csv() {
  local pairs=()
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}" "${WEB_OPTIONAL_SECRETS[@]}"; do
    if secret_has_enabled_version "${name}"; then
      pairs+=("${name}=${name}:latest")
    fi
  done
  local IFS=","
  echo "${pairs[*]}"
}

# List required secret names that have no enabled version (names only).
web_missing_required_secrets() {
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}"; do
    if ! secret_has_enabled_version "${name}"; then
      echo "${name}"
    fi
  done
}

web_print_secret_map() {
  echo "Web runtime secret map (names only — values stay in Secret Manager):"
  echo
  echo "  Required (--set-secrets ENV=NAME:latest):"
  local name
  for name in "${WEB_REQUIRED_SECRETS[@]}"; do
    echo "    ${name} -> ${name}"
  done
  echo
  echo "  Optional (attach when a version exists; mock / skip otherwise):"
  for name in "${WEB_OPTIONAL_SECRETS[@]}"; do
    echo "    ${name} -> ${name}"
  done
  echo
  echo "  Plain env (not secrets):"
  echo "    GITHUB_APP_ID, GITHUB_APP_SLUG, PUBLIC_BASE_URL, AUTH_URL, CDP_NETWORK=base-sepolia"
  echo "    NODE_ENV=production, PORT=8080 (Cloud Run sets PORT)"
}
