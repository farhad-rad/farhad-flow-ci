#!/usr/bin/env bash
# Shared helpers for Farhad Flow CI desktop payload scripts (Wave 2).
# shellcheck disable=SC2034

set -euo pipefail

_DESKTOP_SCRIPTS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${_DESKTOP_SCRIPTS_LIB_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${DESKTOP_DIR}/.." && pwd)"
LOCK_FILE="${DESKTOP_DIR}/versions.lock.json"
RESOURCES_DIR="${DESKTOP_DIR}/resources"
PYTHON_RES="${RESOURCES_DIR}/python"
VENV_RES="${RESOURCES_DIR}/venv"
FRONTEND_RES="${RESOURCES_DIR}/frontend"
ENV_RES="${RESOURCES_DIR}/env"
DEFAULT_ENV_FILE="${ENV_RES}/default.env"
MANIFEST_FILE="${RESOURCES_DIR}/MANIFEST.sha256"
CACHE_DIR="${DESKTOP_DIR}/.cache"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

lock_get() {
  # Usage: lock_get '.python.release_tag'
  need_cmd jq
  [[ -f "${LOCK_FILE}" ]] || die "missing ${LOCK_FILE}"
  local val
  val="$(jq -er "$1" "${LOCK_FILE}")" || die "jq failed for $1 in ${LOCK_FILE}"
  printf '%s' "${val}"
}

detect_host_os() {
  case "$(uname -s)" in
    Linux*) echo linux ;;
    Darwin*) echo darwin ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) die "unsupported host OS: $(uname -s)" ;;
  esac
}

# Map script target → versions.lock.json key under .python.targets
python_target_key() {
  case "$1" in
    linux|linux_x86_64|x86_64-unknown-linux-gnu) echo linux_x86_64 ;;
    windows|windows_x86_64|x86_64-pc-windows-msvc) echo windows_x86_64 ;;
    *) die "unknown python target: $1 (use linux|windows)" ;;
  esac
}

resolve_standalone_python() {
  # Prints absolute path to interpreter under resources/python.
  local root="${1:-${PYTHON_RES}}"
  if [[ -x "${root}/bin/python3" ]]; then
    echo "${root}/bin/python3"
    return 0
  fi
  if [[ -x "${root}/python.exe" ]]; then
    echo "${root}/python.exe"
    return 0
  fi
  if [[ -x "${root}/bin/python" ]]; then
    echo "${root}/bin/python"
    return 0
  fi
  # Nested python/ from some extract layouts
  if [[ -x "${root}/python/bin/python3" ]]; then
    echo "${root}/python/bin/python3"
    return 0
  fi
  if [[ -x "${root}/python/python.exe" ]]; then
    echo "${root}/python/python.exe"
    return 0
  fi
  die "standalone python not found under ${root} (run fetch-python-standalone first)"
}

venv_site_packages() {
  local venv="${1:-${VENV_RES}}"
  local py
  py="$(resolve_standalone_python)"
  local ver
  ver="$("${py}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ -d "${venv}/Lib/site-packages" ]]; then
    echo "${venv}/Lib/site-packages"
    return 0
  fi
  if [[ -d "${venv}/lib/python${ver}/site-packages" ]]; then
    echo "${venv}/lib/python${ver}/site-packages"
    return 0
  fi
  # glob fallback
  local sp
  sp="$(echo "${venv}"/lib/python*/site-packages)"
  [[ -d "${sp}" ]] || die "venv site-packages missing under ${venv}"
  echo "${sp}"
}

# Linux: prepend standalone lib dir so manylinux wheels find libpython / openssl.
# Notes for packagers (also in SIDECAR.md):
#   export LD_LIBRARY_PATH="{resources/python}/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# Standalone builds usually embed RPATH; still set LD_LIBRARY_PATH when relocating
# the tree or when wheels ship .so that dlopen sibling libs.
export_linux_lib_path() {
  local py_root="${1:-${PYTHON_RES}}"
  local libdir=""
  if [[ -d "${py_root}/lib" ]]; then
    libdir="${py_root}/lib"
  elif [[ -d "${py_root}/python/lib" ]]; then
    libdir="${py_root}/python/lib"
  fi
  if [[ -n "${libdir}" ]]; then
    export LD_LIBRARY_PATH="${libdir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
  fi
}

sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${f}" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${f}" | awk '{print $1}'
  else
    python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "${f}"
  fi
}
