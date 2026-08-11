#!/usr/bin/env bash
# Wave 2 — download python-build-standalone into desktop/resources/python/
#
# Usage:
#   ./desktop/scripts/fetch-python-standalone.sh [linux|windows]
#   TARGET=linux ./desktop/scripts/fetch-python-standalone.sh
#
# Reads pins from desktop/versions.lock.json (.python.*).
# Cache: desktop/.cache/python-standalone/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

need_cmd curl
need_cmd tar
need_cmd jq

TARGET="${1:-${TARGET:-}}"
if [[ -z "${TARGET}" ]]; then
  case "$(detect_host_os)" in
    linux) TARGET=linux ;;
    windows) TARGET=windows ;;
    *) die "pass target: linux|windows" ;;
  esac
fi

TARGET_KEY="$(python_target_key "${TARGET}")"
ASSET="$(lock_get ".python.targets.${TARGET_KEY}")"
PREFIX="$(lock_get '.python.asset_url_prefix')"
URL="${PREFIX}/${ASSET}"

mkdir -p "${CACHE_DIR}/python-standalone"
ARCHIVE="${CACHE_DIR}/python-standalone/${ASSET}"

echo "==> fetch python-build-standalone"
echo "    target=${TARGET_KEY}"
echo "    url=${URL}"

if [[ ! -f "${ARCHIVE}" ]]; then
  curl -fL --retry 3 --retry-delay 2 -o "${ARCHIVE}.partial" "${URL}"
  mv "${ARCHIVE}.partial" "${ARCHIVE}"
else
  echo "    cache hit: ${ARCHIVE}"
fi

# Optional companion .sha256 from release (best-effort)
SHA_URL="${URL}.sha256"
SHA_FILE="${ARCHIVE}.sha256"
if curl -fsSL --max-time 30 -o "${SHA_FILE}" "${SHA_URL}" 2>/dev/null; then
  expect="$(awk '{print $1}' "${SHA_FILE}")"
  got="$(sha256_file "${ARCHIVE}")"
  [[ "${expect}" == "${got}" ]] || die "checksum mismatch for ${ASSET}: expected ${expect} got ${got}"
  echo "    sha256 OK"
else
  echo "    WARN: no .sha256 sidecar; recording local digest only"
fi

echo "==> extract → ${PYTHON_RES}"
rm -rf "${PYTHON_RES}"
mkdir -p "${PYTHON_RES}"
TMP_EXTRACT="$(mktemp -d "${CACHE_DIR}/extract-python.XXXXXX")"
cleanup() { rm -rf "${TMP_EXTRACT}"; }
trap cleanup EXIT

# Archives may omit directory entries; tar still creates files. Use -m if needed.
tar -xzf "${ARCHIVE}" -C "${TMP_EXTRACT}"

# Normalize: install_only layout is python/... → flatten into resources/python/
if [[ -d "${TMP_EXTRACT}/python" ]]; then
  # Move contents (including hidden) into PYTHON_RES
  shopt -s dotglob nullglob
  mv "${TMP_EXTRACT}/python/"* "${PYTHON_RES}/"
  shopt -u dotglob nullglob
else
  # Already flat
  shopt -s dotglob nullglob
  mv "${TMP_EXTRACT}/"* "${PYTHON_RES}/"
  shopt -u dotglob nullglob
fi

PY="$(resolve_standalone_python "${PYTHON_RES}")"
echo "==> verify interpreter: ${PY}"
"${PY}" -c 'import sys; print(sys.version)'

# Record digest for later MANIFEST step
mkdir -p "${RESOURCES_DIR}"
echo "$(sha256_file "${ARCHIVE}")  cache/${ASSET}" > "${CACHE_DIR}/python-standalone/${TARGET_KEY}.sha256.txt"

echo "OK: standalone python ready at ${PYTHON_RES}"
