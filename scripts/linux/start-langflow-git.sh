#!/usr/bin/env bash
# Start Langflow Desktop (OSS UI + local backend) with Git-SoT on Linux.
# Usage:
#   ./scripts/linux/start-langflow-git.sh [/path/to/flows-repo] [host] [port]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

FLOWS_DIR="${1:-${LANGFLOW_GIT_FLOWS_DIR:-}}"
HOST="${2:-127.0.0.1}"
PORT="${3:-7860}"

if [[ -z "${FLOWS_DIR}" ]]; then
  echo "Usage: $0 /path/to/flows-repo [host] [port]" >&2
  echo "Or set LANGFLOW_GIT_FLOWS_DIR." >&2
  exit 1
fi

if [[ ! -d "${FLOWS_DIR}" ]]; then
  echo "ERROR: flows dir does not exist: ${FLOWS_DIR}" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git not on PATH (required by GitPython)." >&2
  exit 1
fi

export LANGFLOW_GIT_ENABLED="${LANGFLOW_GIT_ENABLED:-true}"
export LANGFLOW_GIT_FLOWS_DIR="$(cd "${FLOWS_DIR}" && pwd)"
export LANGFLOW_GIT_AUTO_COMMIT="${LANGFLOW_GIT_AUTO_COMMIT:-false}"
export LANGFLOW_AUTO_LOGIN="${LANGFLOW_AUTO_LOGIN:-true}"

echo "Git-SoT root: ${LANGFLOW_GIT_FLOWS_DIR}"
echo "auto-commit:  ${LANGFLOW_GIT_AUTO_COMMIT}"
echo "PAT:          ${LANGFLOW_GIT_PAT:+set (env)}${LANGFLOW_GIT_PAT:-unset (use keyring or Git Auth UI)}"

if [[ ! -d "${REPO_ROOT}/.venv" ]] && [[ ! -f "${REPO_ROOT}/uv.lock" ]]; then
  echo "Hint: run 'uv sync' once if deps missing."
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv not on PATH." >&2
  exit 1
fi

uv sync

FRONTEND="${REPO_ROOT}/src/frontend"
BUILD_DIR=""
if [[ -d "${FRONTEND}/build" ]]; then
  BUILD_DIR="${FRONTEND}/build"
elif [[ -d "${FRONTEND}/dist" ]]; then
  BUILD_DIR="${FRONTEND}/dist"
fi

if [[ -z "${BUILD_DIR}" ]]; then
  echo "Building frontend..."
  (cd "${FRONTEND}" && npm install && npm run build)
  if [[ -d "${FRONTEND}/build" ]]; then
    BUILD_DIR="${FRONTEND}/build"
  elif [[ -d "${FRONTEND}/dist" ]]; then
    BUILD_DIR="${FRONTEND}/dist"
  else
    echo "ERROR: frontend build output missing." >&2
    exit 1
  fi
else
  echo "Using existing frontend build: ${BUILD_DIR}"
fi

echo "Starting Langflow on http://${HOST}:${PORT} ..."
exec uv run langflow run --frontend-path "${BUILD_DIR}" --host "${HOST}" --port "${PORT}"
