#!/usr/bin/env bash
# Wave 2 — orchestrate Linux payload: python fetch → FE bake → venv freeze → manifest
#
# Usage:
#   ./desktop/scripts/build-payload-linux.sh
#   SMOKE_ONLY=1 ./desktop/scripts/build-payload-linux.sh   # lighter freeze
#   SKIP_NPM_BUILD=1 ./desktop/scripts/build-payload-linux.sh
#   SKIP_FREEZE=1 ./desktop/scripts/build-payload-linux.sh  # fetch + FE only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======== Farhad Flow CI desktop payload (linux) ========"
"${SCRIPT_DIR}/fetch-python-standalone.sh" linux
"${SCRIPT_DIR}/bake-frontend.sh"

if [[ "${SKIP_FREEZE:-0}" == "1" ]]; then
  echo "==> SKIP_FREEZE=1 — writing partial manifest"
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/write-manifest.sh"
  write_resources_manifest
else
  "${SCRIPT_DIR}/freeze-venv.sh"
fi

echo "======== payload ready under desktop/resources/ ========"
