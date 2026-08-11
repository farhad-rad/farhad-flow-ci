#!/usr/bin/env bash
# Wave 3 — prove bundled git wins when PATH / GIT_EXEC_PATH point at resources/git.
# Run on Linux after vendor-git.sh. Does not mutate system git.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GIT_ROOT="${DESKTOP_DIR}/resources/git"
GIT_BIN="${GIT_ROOT}/bin"
GIT_EXEC="${GIT_ROOT}/libexec/git-core"

fail() { echo "VERIFY FAIL: $*" >&2; exit 1; }
ok() { echo "VERIFY OK: $*"; }

[[ -x "${GIT_BIN}/git" ]] || fail "missing executable ${GIT_BIN}/git — run vendor-git.sh first"
[[ -d "${GIT_EXEC}" ]] || fail "missing ${GIT_EXEC}"

# Isolate: only bundled bin first; keep minimal system dirs for dynamic linker / coreutils
export PATH="${GIT_BIN}:/usr/bin:/bin"
export GIT_EXEC_PATH="${GIT_EXEC}"
# Avoid picking up user gitconfig surprises for --version
export GIT_CONFIG_NOSYSTEM=1
export HOME="$(mktemp -d "${TMPDIR:-/tmp}/farhad-git-verify-home.XXXXXX")"
cleanup() { rm -rf "${HOME}"; }
trap cleanup EXIT

RESOLVED="$(command -v git)"
case "${RESOLVED}" in
  "${GIT_BIN}/git") ok "command -v git -> ${RESOLVED}" ;;
  *) fail "command -v git resolved to ${RESOLVED}, expected ${GIT_BIN}/git" ;;
esac

VER_OUT="$(git --version)"
ok "${VER_OUT}"

# Must be able to run a helper from GIT_EXEC_PATH (proves exec-path wiring)
HELP_OUT="$(git --exec-path)"
[[ "${HELP_OUT}" == "${GIT_EXEC}" ]] || fail "git --exec-path returned '${HELP_OUT}', expected '${GIT_EXEC}'"
ok "GIT_EXEC_PATH=${HELP_OUT}"

# Init/commit smoke in temp repo (no network)
WORK="$(mktemp -d "${TMPDIR:-/tmp}/farhad-git-verify-repo.XXXXXX")"
trap 'rm -rf "${HOME}" "${WORK}"' EXIT
cd "${WORK}"
git init -q
git config user.email "verify@farhad-flow-ci.local"
git config user.name "Bundled Git Verify"
echo "wave3" >README
git add README
git commit -q -m "verify bundled git"
ok "init/add/commit smoke"

# Prefer bundled over a decoy "system" git earlier in a fake PATH segment after ours
DECOY="$(mktemp -d "${TMPDIR:-/tmp}/farhad-git-decoy.XXXXXX")"
trap 'rm -rf "${HOME}" "${WORK}" "${DECOY}"' EXIT
cat >"${DECOY}/git" <<'EOF'
#!/bin/sh
echo "decoy-system-git" >&2
exit 99
EOF
chmod +x "${DECOY}/git"
# Bundled still first
export PATH="${GIT_BIN}:${DECOY}:/usr/bin:/bin"
OUT="$(git --version 2>&1)" || fail "bundled git failed with decoy present"
[[ "${OUT}" != *decoy* ]] || fail "decoy git was invoked"
ok "bundled preferred over decoy on PATH"

# When bundled removed from PATH, decoy would win — document only; assert decoy callable
export PATH="${DECOY}:/usr/bin:/bin"
unset GIT_EXEC_PATH
DECOY_OUT="$(git --version 2>&1)" && fail "decoy should exit 99" || true
[[ "${DECOY_OUT}" == *decoy-system-git* ]] || fail "expected decoy stderr"
ok "system/decoy git still reachable if PATH omits bundle (optional fallback)"

# Optional: GitPython sees bundled git (sidecar parity). Skip if package absent.
if python3 -c "import git" >/dev/null 2>&1; then
  PY_OUT="$(
    PATH="${GIT_BIN}:/usr/bin:/bin" GIT_EXEC_PATH="${GIT_EXEC}" python3 - <<'PY'
import git
g = git.Git()
print("version_info", g.version_info)
print("version", g.execute(["git", "--version"]))
PY
  )"
  echo "${PY_OUT}" | grep -q "2.55" || fail "GitPython did not report bundled 2.55: ${PY_OUT}"
  ok "GitPython via sidecar env: ${PY_OUT//$'\n'/; }"
else
  ok "GitPython not installed — skipped (CLI verify sufficient)"
fi

echo
echo "All bundled-git checks passed."
echo "System git remains optional; sidecar must prepend resources/git and set GIT_EXEC_PATH (see git-env.md)."
