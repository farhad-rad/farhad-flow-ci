#!/usr/bin/env bash
# Wave 3 — vendor portable Linux git into desktop/resources/git/
# Reads pins from desktop/versions.lock.json (git.linux.*).
# Layout: bin/git + libexec/git-core/ (GIT_EXEC_PATH).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCK="${DESKTOP_DIR}/versions.lock.json"
DEST="${DESKTOP_DIR}/resources/git"
CACHE_DIR="${DESKTOP_DIR}/.cache/git-src"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"

if [[ ! -f "${LOCK}" ]]; then
  echo "error: missing ${LOCK}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq required" >&2
  exit 1
fi

VERSION="$(jq -r '.git.linux.version' "${LOCK}")"
URL="$(jq -r '.git.linux.source' "${LOCK}")"
EXPECTED_SHA="$(jq -r '.git.linux.sha256 // empty' "${LOCK}")"
TARBALL_NAME="$(basename "${URL}")"
SRC_DIR_NAME="git-${VERSION}"

if [[ -z "${VERSION}" || "${VERSION}" == "null" || -z "${URL}" || "${URL}" == "null" ]]; then
  echo "error: git.linux.version/source missing in ${LOCK}" >&2
  exit 1
fi

mkdir -p "${CACHE_DIR}"
TARBALL_PATH="${CACHE_DIR}/${TARBALL_NAME}"

echo "==> Wave 3 vendor-git (Linux ${VERSION})"
echo "    url:  ${URL}"
echo "    dest: ${DEST}"

if [[ ! -f "${TARBALL_PATH}" ]]; then
  echo "==> downloading ${TARBALL_NAME}"
  curl -fL --retry 3 --retry-delay 2 -o "${TARBALL_PATH}.partial" "${URL}"
  mv "${TARBALL_PATH}.partial" "${TARBALL_PATH}"
else
  echo "==> using cached ${TARBALL_PATH}"
fi

if [[ -n "${EXPECTED_SHA}" ]]; then
  ACTUAL_SHA="$(sha256sum "${TARBALL_PATH}" | awk '{print $1}')"
  if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
    echo "error: sha256 mismatch for ${TARBALL_NAME}" >&2
    echo "  expected: ${EXPECTED_SHA}" >&2
    echo "  actual:   ${ACTUAL_SHA}" >&2
    exit 1
  fi
  echo "==> sha256 OK"
fi

BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/farhad-git-build.XXXXXX")"
cleanup() { rm -rf "${BUILD_ROOT}"; }
trap cleanup EXIT

echo "==> extracting"
tar -xJf "${TARBALL_PATH}" -C "${BUILD_ROOT}"
SRC="${BUILD_ROOT}/${SRC_DIR_NAME}"
if [[ ! -d "${SRC}" ]]; then
  echo "error: expected source dir ${SRC}" >&2
  exit 1
fi

# Fresh DEST layout (keep .gitkeep / docs if present outside wipe of contents we own)
echo "==> installing into ${DEST}"
rm -rf "${DEST}/bin" "${DEST}/libexec" "${DEST}/share" "${DEST}/lib" "${DEST}/etc"
mkdir -p "${DEST}"

# Portable-ish install: prefix = resources/git so bin/ + libexec/git-core/ land correctly.
# Skip heavy optional bindings; link against system OpenSSL/zlib/curl (Ubuntu staff machines).
# NO_RUST: git 2.55+ can require cargo/libgitcore; disable for reproducible CI without Rust toolchain.
# Ensure ~/.cargo/bin on PATH only if building WITH rust (not default).
export PATH="${HOME}/.cargo/bin:/usr/bin:/bin:${PATH:-}"
make -C "${SRC}" -j"${JOBS}" \
  prefix="${DEST}" \
  NO_GETTEXT=YesPlease \
  NO_TCLTK=YesPlease \
  NO_PYTHON=YesPlease \
  NO_PERL=YesPlease \
  NO_RUST=YesPlease \
  all

make -C "${SRC}" \
  prefix="${DEST}" \
  NO_GETTEXT=YesPlease \
  NO_TCLTK=YesPlease \
  NO_PYTHON=YesPlease \
  NO_PERL=YesPlease \
  NO_RUST=YesPlease \
  install

if [[ ! -x "${DEST}/bin/git" ]]; then
  echo "error: ${DEST}/bin/git missing after install" >&2
  exit 1
fi

GIT_EXEC_PATH_REL="libexec/git-core"
if [[ ! -d "${DEST}/${GIT_EXEC_PATH_REL}" ]]; then
  echo "error: ${DEST}/${GIT_EXEC_PATH_REL} missing after install" >&2
  exit 1
fi

# Stamp for Wave 2 MANIFEST / later verify
cat >"${DEST}/.vendor-stamp.json" <<EOF
{
  "platform": "linux",
  "version": "${VERSION}",
  "source": "${URL}",
  "sha256_tarball": "${EXPECTED_SHA}",
  "vendored_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_exec_path_rel": "${GIT_EXEC_PATH_REL}",
  "bin_rel": "bin/git"
}
EOF

# Optional: emit sha256 lines Wave 2 can merge into resources/MANIFEST.sha256
if [[ -x "${SCRIPT_DIR}/manifest-git-entries.sh" ]]; then
  "${SCRIPT_DIR}/manifest-git-entries.sh" >"${DEST}/MANIFEST.sha256.fragment" || true
fi

BUNDLED_VER="$("${DEST}/bin/git" --exec-path="${DEST}/${GIT_EXEC_PATH_REL}" --version)"
echo "==> vendored OK: ${BUNDLED_VER}"
echo "    GIT_EXEC_PATH -> ${DEST}/${GIT_EXEC_PATH_REL}"
echo "    next: desktop/scripts/verify-bundled-git.sh"
