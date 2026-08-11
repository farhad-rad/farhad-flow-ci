#!/usr/bin/env bash
# Wave 2 — bake production frontend into desktop/resources/frontend/
#
# Reuses Makefile.frontend build_frontend patterns:
#   cd src/frontend && CI='' npm run build
# then copies build output → desktop/resources/frontend/
# (also mirrors into src/backend/base/langflow/frontend like make build_frontend)
#
# Usage:
#   ./desktop/scripts/bake-frontend.sh
#   SKIP_NPM_BUILD=1 ./desktop/scripts/bake-frontend.sh   # copy existing src/frontend/build only
#   NPM_CI=1 ./desktop/scripts/bake-frontend.sh           # npm ci before build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

FRONTEND_DIR="${REPO_ROOT}/src/frontend"
BACKEND_FE="${REPO_ROOT}/src/backend/base/langflow/frontend"

need_cmd npm

[[ -d "${FRONTEND_DIR}" ]] || die "missing ${FRONTEND_DIR}"

build_out=""
resolve_build_out() {
  if [[ -f "${FRONTEND_DIR}/build/index.html" ]]; then
    build_out="${FRONTEND_DIR}/build"
  elif [[ -f "${FRONTEND_DIR}/dist/index.html" ]]; then
    build_out="${FRONTEND_DIR}/dist"
  else
    build_out=""
  fi
}

if [[ "${SKIP_NPM_BUILD:-0}" == "1" ]]; then
  resolve_build_out
  [[ -n "${build_out}" ]] || die "SKIP_NPM_BUILD=1 but no src/frontend/{build,dist}/index.html"
  echo "==> SKIP_NPM_BUILD=1 — using ${build_out}"
else
  need_cmd node
  echo "==> node $(node -v) npm $(npm -v)"
  if [[ "${NPM_CI:-0}" == "1" ]]; then
    echo "==> npm ci"
    (cd "${FRONTEND_DIR}" && npm ci)
  elif [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
    echo "==> npm install (node_modules missing)"
    (cd "${FRONTEND_DIR}" && npm install)
  fi
  echo "==> npm run build (Makefile.frontend build_frontend)"
  (cd "${FRONTEND_DIR}" && CI='' npm run build)
  resolve_build_out
  [[ -n "${build_out}" ]] || die "frontend build produced no index.html under build/ or dist/"
fi

echo "==> sync backend package path ${BACKEND_FE}"
rm -rf "${BACKEND_FE}"
mkdir -p "${BACKEND_FE}"
cp -a "${build_out}/." "${BACKEND_FE}/"

echo "==> copy → ${FRONTEND_RES}"
rm -rf "${FRONTEND_RES}"
mkdir -p "${FRONTEND_RES}"
cp -a "${build_out}/." "${FRONTEND_RES}/"
# drop placeholder if somehow present
rm -f "${FRONTEND_RES}/.gitkeep"

[[ -f "${FRONTEND_RES}/index.html" ]] || die "missing ${FRONTEND_RES}/index.html after bake"

# Refresh manifest entry for frontend if python/venv already present
if [[ -x "${SCRIPT_DIR}/write-manifest.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/write-manifest.sh"
  write_resources_manifest || true
fi

echo "OK: frontend baked → ${FRONTEND_RES}"
