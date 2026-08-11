#!/usr/bin/env bash
# List files changed vs upstream baseline (Desktop patch surface).
# Usage:
#   ./scripts/git-sot/list_patched_files.sh
#   BASE=baseline/v1.11.2 ./scripts/git-sot/list_patched_files.sh
#   BASE=v1.11.2 HEAD=HEAD ./scripts/git-sot/list_patched_files.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

BASE="${BASE:-baseline/v1.11.2}"
TIP="${HEAD:-HEAD}"

if ! git rev-parse --verify "${BASE}" >/dev/null 2>&1; then
  echo "WARN: ${BASE} not found; trying v1.11.2" >&2
  BASE="v1.11.2"
fi

if ! git rev-parse --verify "${BASE}" >/dev/null 2>&1; then
  echo "ERROR: no baseline ref (${BASE}). Tag baseline/v1.11.2 first." >&2
  exit 1
fi

echo "# Patched files: ${BASE}..${TIP}"
echo "# Generated: $(date -u +%Y-%m-%dT%H:%MZ)"
echo

echo "## All changed paths"
git diff --name-only "${BASE}...${TIP}" | sort
echo

echo "## Hotspots (flow_git / git API / git UI)"
git diff --name-only "${BASE}...${TIP}" | sort | grep -E \
  'flow_git/|/api/v1/git\.py|flows_helpers|features/git|gitPanel|GitAuth|git-conflicts|settings/groups/git|DESKTOP_DEV_|git-sot/|scripts/linux/|scripts/git-sot/' \
  || true
echo

echo "## Stat (committed)"
git diff --stat "${BASE}...${TIP}" | tail -n 5 || true
echo

# When work is still uncommitted (common pre-tag), also list WT paths.
if [[ "$(git rev-parse "${BASE}")" == "$(git rev-parse "${TIP}")" ]] || [[ -n "$(git status --porcelain)" ]]; then
  echo "## Working tree (uncommitted) — full Desktop surface"
  git status --porcelain | awk '{print $NF}' | sort -u
  echo
  echo "## Working tree hotspots"
  git status --porcelain | awk '{print $NF}' | sort -u | grep -E \
    'flow_git/|/api/v1/git\.py|flows_helpers|features/git|gitPanel|GitAuth|git-conflicts|settings/groups/git|DESKTOP_DEV_|git-sot/|scripts/linux/|scripts/git-sot/' \
    || true
fi
