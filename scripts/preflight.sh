#!/usr/bin/env bash
# =============================================================================
# preflight.sh — verify the API port chain before / after a deploy.
#
# Catches the exact drift that causes 502s at api.inferr.xyz:
#   tunnel target  !=  published host port  !=  API_URL  !=  NEXT_PUBLIC_API_URL
#
# Usage:  bash scripts/preflight.sh
# Exit:   0 = all good, 1 = at least one check failed.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✖ No .env found at $ENV_FILE — copy .env.example first."
  exit 1
fi

# --- read a key from .env without sourcing it (avoids evaluating secrets) ----
env_get() {
  local key="$1" default="${2:-}"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$default"
    return
  fi
  local val="${line#*=}"
  val="${val%$'\r'}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

API_HOST_PORT="$(env_get API_HOST_PORT 3001)"
API_PORT="$(env_get API_PORT 3001)"
API_URL="$(env_get API_URL '')"
FRONTEND_URL="$(env_get FRONTEND_URL '')"
NEXT_PUBLIC_API_URL="$(env_get NEXT_PUBLIC_API_URL '')"

fail=0
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$1"; fail=1; }
note() { printf '  \033[36m•\033[0m %s\n' "$1"; }

echo "inferr preflight — port chain"
echo "--------------------------------------------------------------------"
note "tunnel MUST target:  http://localhost:${API_HOST_PORT}"
note "docker publishes:    ${API_HOST_PORT}:${API_PORT}"
echo

# 1. Is the API answering on the host-published port?
if curl -fsS --max-time 5 "http://localhost:${API_HOST_PORT}/health" >/dev/null 2>&1; then
  ok "API answers on http://localhost:${API_HOST_PORT}/health"
else
  bad "nothing answers on http://localhost:${API_HOST_PORT}/health (is the stack up?)"
fi

# 2. Does the public URL answer (tunnel in place)
if [[ -n "$API_URL" ]]; then
  if curl -fsS --max-time 10 "${API_URL}/health" >/dev/null 2>&1; then
    ok "public ${API_URL}/health reaches the API"
  else
    bad "public ${API_URL}/health is unreachable"
    note "→ check the cloudflared tunnel target equals localhost:${API_HOST_PORT}"
  fi
else
  bad "API_URL is not set in .env"
fi

# 3. Does the browser URL match the public API URL?
if [[ -n "$NEXT_PUBLIC_API_URL" && -n "$API_URL" ]]; then
  if [[ "${NEXT_PUBLIC_API_URL%/}" == "${API_URL%/}" ]]; then
    ok "NEXT_PUBLIC_API_URL matches API_URL (${API_URL})"
  else
    bad "NEXT_PUBLIC_API_URL (${NEXT_PUBLIC_API_URL}) != API_URL (${API_URL})"
    note "→ the web bundle will call the wrong host"
  fi
fi

# 4. Sanity: public URL should not point at localhost on a real deployment
if [[ -n "$API_URL" && "$API_URL" == *localhost* && "$FRONTEND_URL" == https://* ]]; then
  bad "API_URL is localhost but FRONTEND_URL is public — mixed dev/prod config"
fi

# 5. Google redirect URIs derived from API_URL (for the console checklist)
echo
note "Register these in Google Console → Authorized redirect URIs:"
note "  ${API_URL}/auth/google/callback"
note "  ${API_URL}/auth/google/mcp-callback"

echo "--------------------------------------------------------------------"
if [[ "$fail" -eq 0 ]]; then
  echo "✔ port chain looks consistent"
else
  echo "✖ port chain has problems (see above)"
fi
exit "$fail"
