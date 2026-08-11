#!/usr/bin/env bash
# Wave 8 — CI sidecar health smoke (Linux, no WebView / no interactive GUI).
#
# Spawns frozen resources/run-langflow.sh on loopback, curls health endpoints,
# then kills the process group. Does NOT launch the Tauri shell.
#
# Prerequisites:
#   - Full freeze (SMOKE_ONLY=0) so `python -m langflow` exists in the venv
#   - desktop/resources/MANIFEST.sha256 present
#   - Bundled git optional but preferred (PATH prepend if present)
#
# Usage:
#   ./desktop/scripts/ci-sidecar-health-smoke.sh
#   PORT=7860 WAIT_SECONDS=180 ./desktop/scripts/ci-sidecar-health-smoke.sh
#
# Exit:
#   0 — health OK
#   1 — fail (MANIFEST missing, spawn fail, or health timeout)
#   0 + skip message if SMOKE_ONLY=1 (venv lacks langflow)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOURCES="${DESKTOP_DIR}/resources"
LAUNCHER="${RESOURCES}/run-langflow.sh"
MANIFEST="${RESOURCES}/MANIFEST.sha256"
PORT="${PORT:-7860}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
HOST="127.0.0.1"

echo "======== CI sidecar health smoke (Linux, no WebView) ========"

if [[ "${SMOKE_ONLY:-0}" == "1" ]]; then
  echo "SKIP: SMOKE_ONLY=1 — venv is thin (httpx/GitPython only); no langflow health."
  echo "      Re-run with full freeze (tag desktop-v* or smoke_only=false) for curl smoke."
  exit 0
fi

if [[ ! -f "${MANIFEST}" ]]; then
  echo "ERROR: missing ${MANIFEST}" >&2
  exit 1
fi
echo "==> MANIFEST.sha256 OK"

if [[ ! -x "${LAUNCHER}" ]]; then
  if [[ -f "${LAUNCHER}" ]]; then
    chmod +x "${LAUNCHER}"
  else
    echo "ERROR: missing launcher ${LAUNCHER} — run freeze/build first" >&2
    exit 1
  fi
fi

# Prove langflow importable before long wait
PY="${RESOURCES}/python/bin/python3"
[[ -x "${PY}" ]] || PY="${RESOURCES}/python/bin/python"
if [[ ! -x "${PY}" ]]; then
  echo "ERROR: standalone python missing under resources/python" >&2
  exit 1
fi
export VIRTUAL_ENV="${RESOURCES}/venv"
export PYTHONNOUSERSITE=1
if [[ -d "${RESOURCES}/python/lib" ]]; then
  export LD_LIBRARY_PATH="${RESOURCES}/python/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi
SITE="$("${PY}" -c 'import sys,os; print(os.path.join(os.environ["VIRTUAL_ENV"],"lib",f"python{sys.version_info[0]}.{sys.version_info[1]}","site-packages"))')"
export PYTHONPATH="${SITE}${PYTHONPATH:+:${PYTHONPATH}}"
export PATH="${VIRTUAL_ENV}/bin:${RESOURCES}/python/bin:${PATH}"

# Bundled git for sidecar PATH (Wave 3)
if [[ -x "${RESOURCES}/git/bin/git" ]]; then
  export PATH="${RESOURCES}/git/bin:${PATH}"
  if [[ -d "${RESOURCES}/git/libexec/git-core" ]]; then
    export GIT_EXEC_PATH="${RESOURCES}/git/libexec/git-core"
  fi
  echo "==> bundled git on PATH"
fi

echo "==> import check: python -c 'import langflow'"
if ! "${PY}" -c "import langflow; print('langflow OK')" 2>&1; then
  echo "ERROR: langflow not importable — full freeze required for health smoke" >&2
  exit 1
fi

CFG_DIR="${TMPDIR:-/tmp}/farhad-flow-ci-ci-smoke-$$"
mkdir -p "${CFG_DIR}/logs"
export LANGFLOW_CONFIG_DIR="${CFG_DIR}"
export LANGFLOW_AUTO_LOGIN=true
export LANGFLOW_GIT_ENABLED=true
export LANGFLOW_HOST="${HOST}"
export LANGFLOW_PORT="${PORT}"
# Do not set LANGFLOW_GIT_FLOWS_DIR — wizard path / empty repo OK for health

LOG="${CFG_DIR}/logs/sidecar.log"
echo "==> spawn sidecar port=${PORT} log=${LOG}"

# Process group so we can kill children on exit
set +e
setsid "${LAUNCHER}" run --host "${HOST}" --port "${PORT}" --frontend-path "${RESOURCES}/frontend" \
  >"${LOG}" 2>&1 &
SIDECAR_PID=$!
set -e

cleanup() {
  if [[ -n "${SIDECAR_PID:-}" ]] && kill -0 "${SIDECAR_PID}" 2>/dev/null; then
    echo "==> kill sidecar pgid ${SIDECAR_PID}"
    kill -TERM -"${SIDECAR_PID}" 2>/dev/null || kill -TERM "${SIDECAR_PID}" 2>/dev/null || true
    sleep 2
    kill -KILL -"${SIDECAR_PID}" 2>/dev/null || kill -KILL "${SIDECAR_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

deadline=$((SECONDS + WAIT_SECONDS))
ok=0
urls=(
  "http://${HOST}:${PORT}/api/v1/git/health"
  "http://${HOST}:${PORT}/health"
  "http://${HOST}:${PORT}/api/v1/health"
)

echo "==> poll health (up to ${WAIT_SECONDS}s)"
while (( SECONDS < deadline )); do
  for u in "${urls[@]}"; do
    code="$(curl -sS -o /tmp/ffci-health-body.$$ -w '%{http_code}' --max-time 3 "${u}" 2>/dev/null || echo 000)"
    if [[ "${code}" =~ ^2 ]]; then
      echo "OK health: ${u} → HTTP ${code}"
      head -c 200 /tmp/ffci-health-body.$$ 2>/dev/null || true
      echo
      ok=1
      break 2
    fi
  done
  # Port fallback scan once near mid-wait
  if (( SECONDS > WAIT_SECONDS / 3 )); then
    for p in $(seq 7860 7870); do
      [[ "${p}" == "${PORT}" ]] && continue
      for path in /api/v1/git/health /health /api/v1/health; do
        u="http://${HOST}:${p}${path}"
        code="$(curl -sS -o /tmp/ffci-health-body.$$ -w '%{http_code}' --max-time 2 "${u}" 2>/dev/null || echo 000)"
        if [[ "${code}" =~ ^2 ]]; then
          echo "OK health (fallback port): ${u} → HTTP ${code}"
          ok=1
          break 3
        fi
      done
    done
  fi
  if ! kill -0 "${SIDECAR_PID}" 2>/dev/null; then
    echo "ERROR: sidecar exited early — last log lines:" >&2
    tail -n 80 "${LOG}" >&2 || true
    exit 1
  fi
  sleep 3
done

rm -f /tmp/ffci-health-body.$$ 2>/dev/null || true

if [[ "${ok}" != "1" ]]; then
  echo "ERROR: health not reachable within ${WAIT_SECONDS}s" >&2
  echo "---- sidecar.log (tail) ----" >&2
  tail -n 120 "${LOG}" >&2 || true
  exit 1
fi

echo "======== SIDECAR HEALTH SMOKE PASS ========"
