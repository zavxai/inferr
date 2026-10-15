#!/usr/bin/env bash
#
# Deploy PRODUCTION from origin/<branch> into this (prod) worktree.
#
# Prod is a mirror of GitHub: no local edits, no live bind-mounts. This script
# hard-resets the worktree to the remote branch, rebuilds, and restarts the stack.
#
# Usage:  bash scripts/deploy-prod.sh
# Env:    PROD_BRANCH (default: main)  PROD_PROJECT (default: inferr)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROD_DIR}"

BRANCH="${PROD_BRANCH:-main}"
PROJECT="${PROD_PROJECT:-inferr}"

echo "==> Prod dir : ${PROD_DIR}"
echo "==> Branch   : ${BRANCH}"
echo "==> Project  : ${PROJECT}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: ${PROD_DIR} has uncommitted tracked changes." >&2
  echo "       Prod must be a clean mirror of origin/${BRANCH}. Commit/PR your work first." >&2
  git status --short
  exit 1
fi

echo "==> Fetching origin/${BRANCH}"
git fetch origin --prune
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

echo "==> Building + (re)starting prod stack"
docker compose -p "${PROJECT}" --env-file .env \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "==> Deployed $(git rev-parse --short HEAD) to prod (project: ${PROJECT})"
