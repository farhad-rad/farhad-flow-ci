#!/usr/bin/env bash
# Wave 7 — Ubuntu amd64 .deb: payload → vendor git → tauri build --bundles deb
#
# Usage:
#   ./desktop/scripts/build-ubuntu.sh
#   SMOKE_ONLY=1 ./desktop/scripts/build-ubuntu.sh          # lighter freeze (packaging smoke)
#   SKIP_PAYLOAD=1 ./desktop/scripts/build-ubuntu.sh        # reuse existing desktop/resources/
#   SKIP_GIT=1 ./desktop/scripts/build-ubuntu.sh            # skip vendor-git.sh
#   SKIP_NPM_BUILD=1 ./desktop/scripts/build-ubuntu.sh      # pass through to bake-frontend
#
# Artifact:
#   Tauri raw:  "Farhad Flow CI_X.Y.Z_amd64.deb" (productName)
#   Canonical:  farhad-flow-ci_X.Y.Z_amd64.deb  (copied to desktop/dist/)
#   Staff alias: FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb
# Control Package field is always farhad-flow-ci (Cargo.toml name).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DESKTOP_DIR}/.." && pwd)"
SRC_TAURI="${DESKTOP_DIR}/src-tauri"

VERSION="$(python3 -c "import json; print(json.load(open('${SRC_TAURI}/tauri.conf.json'))['version'])")"
# Canonical dpkg name (Wave 7 task 64). Tauri may emit productName with spaces first.
DEB_NAME="farhad-flow-ci_${VERSION}_amd64.deb"
TAURI_RAW_DEB="Farhad Flow CI_${VERSION}_amd64.deb"
RELEASE_NAME="FarhadFlowCI-desktop-v${VERSION}-ubuntu-amd64.deb"

echo "======== Farhad Flow CI Ubuntu .deb (v${VERSION}) ========"

if [[ "${SKIP_PAYLOAD:-0}" != "1" ]]; then
  echo "==> payload (build-payload-linux.sh)"
  # shellcheck disable=SC2086
  env SMOKE_ONLY="${SMOKE_ONLY:-0}" SKIP_NPM_BUILD="${SKIP_NPM_BUILD:-0}" \
    "${SCRIPT_DIR}/build-payload-linux.sh"
else
  echo "==> SKIP_PAYLOAD=1 — using existing desktop/resources/"
fi

if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  if [[ -x "${SRC_TAURI}/../resources/git/bin/git" ]] || [[ -x "${DESKTOP_DIR}/resources/git/bin/git" ]]; then
    echo "==> bundled git already present — skip vendor (set FORCE_VENDOR_GIT=1 to rebuild)"
    if [[ "${FORCE_VENDOR_GIT:-0}" == "1" ]]; then
      "${SCRIPT_DIR}/vendor-git.sh"
    fi
  else
    echo "==> vendor-git.sh"
    "${SCRIPT_DIR}/vendor-git.sh"
  fi
else
  echo "==> SKIP_GIT=1"
fi

if [[ ! -f "${DESKTOP_DIR}/resources/MANIFEST.sha256" ]]; then
  echo "ERROR: missing desktop/resources/MANIFEST.sha256 — run payload build first" >&2
  exit 1
fi

cd "${DESKTOP_DIR}"
if [[ ! -d node_modules/@tauri-apps/cli ]]; then
  echo "==> npm install (desktop/)"
  npm install
fi

echo "==> tauri build --bundles deb (amd64)"
# Disk-tight hosts: prefer existing CARGO_TARGET_DIR; else default under src-tauri/target
npx tauri build --bundles deb

find_deb() {
  local name="$1"
  local candidates=(
    "${SRC_TAURI}/target/release/bundle/deb/${name}"
    "${SRC_TAURI}/target/x86_64-unknown-linux-gnu/release/bundle/deb/${name}"
  )
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    candidates+=(
      "${CARGO_TARGET_DIR}/release/bundle/deb/${name}"
      "${CARGO_TARGET_DIR}/x86_64-unknown-linux-gnu/release/bundle/deb/${name}"
    )
  fi
  # Common overflow target used on tight rootfs
  candidates+=(
    "/dev/shm/lf-cargo-target/release/bundle/deb/${name}"
    "/tmp/lf-cargo-target/release/bundle/deb/${name}"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

BUNDLE_DEB="$(find_deb "${DEB_NAME}" || true)"
if [[ -z "${BUNDLE_DEB}" ]]; then
  BUNDLE_DEB="$(find_deb "${TAURI_RAW_DEB}" || true)"
fi

if [[ -z "${BUNDLE_DEB}" ]]; then
  echo "ERROR: expected deb not found (tried ${DEB_NAME} and ${TAURI_RAW_DEB})" >&2
  echo "Searched under src-tauri/target, CARGO_TARGET_DIR, /dev/shm|/tmp/lf-cargo-target" >&2
  find "${SRC_TAURI}/target" "${CARGO_TARGET_DIR:-/nonexistent}" /dev/shm/lf-cargo-target \
    -path '*/bundle/deb/*.deb' 2>/dev/null | head -20 || true
  exit 1
fi

OUT_DIR="${DESKTOP_DIR}/dist"
mkdir -p "${OUT_DIR}"
# Always publish canonical dpkg name + staff channel alias (Package: farhad-flow-ci)
cp -f "${BUNDLE_DEB}" "${OUT_DIR}/${DEB_NAME}"
cp -f "${BUNDLE_DEB}" "${OUT_DIR}/${RELEASE_NAME}"

echo "======== deb ready ========"
echo "  built:    ${BUNDLE_DEB}"
echo "  package:  ${OUT_DIR}/${DEB_NAME}"
echo "  release:  ${OUT_DIR}/${RELEASE_NAME}"
echo "  smoke:    see desktop/scripts/SMOKE-ubuntu.md"
echo "  install:  sudo dpkg -i ${OUT_DIR}/${DEB_NAME}"
