#!/usr/bin/env bash
# Wave 2 hook: emit sha256 lines for vendored git binaries to merge into resources/MANIFEST.sha256.
# Paths are relative to desktop/resources/ (same style expected by boot verify).
# Usage: desktop/scripts/manifest-git-entries.sh >> desktop/resources/MANIFEST.sha256
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GIT_ROOT="${DESKTOP_DIR}/resources/git"
RES_ROOT="${DESKTOP_DIR}/resources"

if [[ ! -d "${GIT_ROOT}" ]]; then
  echo "error: ${GIT_ROOT} missing" >&2
  exit 1
fi

# Critical paths — Linux layout; Windows MinGit uses cmd/git.exe (handled by .ps1 sibling)
emit() {
  local abs="$1"
  local rel="${abs#"${RES_ROOT}/"}"
  if [[ -f "${abs}" || -L "${abs}" ]]; then
    # sha256sum prints "HASH  path"; rewrite to HASH  relative
    local hash
    hash="$(sha256sum "${abs}" | awk '{print $1}')"
    printf '%s  %s\n' "${hash}" "${rel}"
  fi
}

if [[ -x "${GIT_ROOT}/bin/git" ]]; then
  emit "${GIT_ROOT}/bin/git"
fi

# Hash a sample of git-core helpers so MANIFEST covers exec-path payload (not every file — keep lean)
if [[ -d "${GIT_ROOT}/libexec/git-core" ]]; then
  for name in git git-remote-http git-remote-https git-remote-ssh; do
    p="${GIT_ROOT}/libexec/git-core/${name}"
    [[ -e "${p}" ]] && emit "${p}"
  done
fi

# Windows MinGit (when vendored on Win or cross-copied)
if [[ -f "${GIT_ROOT}/cmd/git.exe" ]]; then
  emit "${GIT_ROOT}/cmd/git.exe"
fi
