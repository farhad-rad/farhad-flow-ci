#!/usr/bin/env bash
# Wave 10 — fail if installer payload embeds private key material or PAT-like secrets.
# Usage:
#   ./desktop/scripts/scan-secrets-in-payload.sh
#   ./desktop/scripts/scan-secrets-in-payload.sh /path/to/resources
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-${ROOT}/resources}"
ALLOWLIST="${ROOT}/scripts/scan-secrets-allowlist.txt"

if [[ ! -d "${TARGET}" ]]; then
  echo "ERROR: resources dir missing: ${TARGET}" >&2
  echo "Build payload first, or pass an explicit path." >&2
  exit 2
fi

echo "==> scanning payload for secrets: ${TARGET}"

FAIL=0
HITS=()

is_allowlisted() {
  local rel="$1"
  [[ -f "${ALLOWLIST}" ]] || return 1
  # Exact relative path match (POSIX paths) or basename for known public keys.
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    if [[ "${rel}" == "${line}" || "$(basename "${rel}")" == "${line}" ]]; then
      return 0
    fi
  done < "${ALLOWLIST}"
  return 1
}

# --- .pem / .key files: private keys fail; public CA / CERTIFICATE-only OK ---
while IFS= read -r -d '' pem; do
  rel="${pem#"${TARGET}"/}"
  if is_allowlisted "${rel}"; then
    echo "OK allowlisted pem: ${rel}"
    continue
  fi
  # Known public CA bundles shipped inside frozen venv / pip (not staff secrets).
  case "${rel}" in
    */certifi/cacert.pem|*/pip/_vendor/certifi/cacert.pem)
      echo "OK public CA bundle: ${rel}"
      continue
      ;;
  esac
  if grep -qE 'BEGIN ([A-Z0-9 ]+)?PRIVATE KEY|BEGIN OPENSSH PRIVATE KEY|BEGIN RSA PRIVATE KEY' "${pem}" 2>/dev/null; then
    echo "FAIL private key pem: ${rel}" >&2
    HITS+=("pem-private:${rel}")
    FAIL=1
    continue
  fi
  if grep -qE 'BEGIN CERTIFICATE' "${pem}" 2>/dev/null; then
    echo "OK certificate-only pem: ${rel}"
    continue
  fi
  # Unknown .pem/.key without CERTIFICATE marker — fail closed.
  echo "FAIL unknown pem/key (not certificate-only): ${rel}" >&2
  HITS+=("pem-unknown:${rel}")
  FAIL=1
done < <(find "${TARGET}" -type f \( -iname '*.pem' -o -iname '*.key' \) -print0 2>/dev/null || true)

# --- content patterns (skip binary-ish via grep -I / -a carefully) ---
# Scan text-ish files only; skip known large binary trees by extension.
PATTERN_FILE="$(mktemp)"
trap 'rm -f "${PATTERN_FILE}"' EXIT
cat > "${PATTERN_FILE}" <<'EOF'
glpat-[A-Za-z0-9_\-]{20,}
ghp_[A-Za-z0-9]{20,}
gho_[A-Za-z0-9]{20,}
github_pat_[A-Za-z0-9_]{20,}
-----BEGIN ([A-Z0-9 ]+)?PRIVATE KEY-----
-----BEGIN RSA PRIVATE KEY-----
-----BEGIN OPENSSH PRIVATE KEY-----
EOF

# ripgrep preferred; fall back to grep -R
scan_with_rg() {
  local pat="$1"
  rg -I -n --hidden --no-messages \
    -g '!.git/**' \
    -g '!**/__pycache__/**' \
    -g '!**/*.pyc' \
    -g '!**/*.so' \
    -g '!**/*.dll' \
    -g '!**/*.pyd' \
    -g '!**/*.exe' \
    -g '!**/*.whl' \
    -g '!**/node_modules/**' \
    -e "${pat}" "${TARGET}" || true
}

scan_with_grep() {
  local pat="$1"
  grep -RIn --binary-files=without-match -E "${pat}" "${TARGET}" \
    --exclude-dir=__pycache__ \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude='*.pyc' \
    --exclude='*.so' \
    --exclude='*.dll' \
    --exclude='*.pyd' \
    --exclude='*.exe' \
    --exclude='*.whl' 2>/dev/null || true
}

SCANNER=scan_with_grep
if command -v rg >/dev/null 2>&1; then
  SCANNER=scan_with_rg
fi

while IFS= read -r pat || [[ -n "${pat}" ]]; do
  [[ -z "${pat}" ]] && continue
  while IFS= read -r hit || [[ -n "${hit}" ]]; do
    [[ -z "${hit}" ]] && continue
    # hit format: path:line:content
    file="${hit%%:*}"
    rel="${file#"${TARGET}"/}"
    if is_allowlisted "${rel}"; then
      echo "OK allowlisted hit: ${rel}"
      continue
    fi
    echo "FAIL secret-like match (${pat}): ${hit}" >&2
    HITS+=("pattern:${rel}")
    FAIL=1
  done < <("${SCANNER}" "${pat}")
done < "${PATTERN_FILE}"

if [[ "${FAIL}" -ne 0 ]]; then
  echo >&2
  echo "ERROR: secrets or private key material found in payload (${#HITS[@]} hit(s))." >&2
  echo "Remove them from resources/ before packaging. Public keys belong in {config_dir}, not the installer." >&2
  echo "Allowlist (public only): ${ALLOWLIST}" >&2
  exit 1
fi

echo "OK: no .pem/.key (unallowlisted) or PAT/private-key patterns in ${TARGET}"
exit 0
