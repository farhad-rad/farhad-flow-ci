#!/usr/bin/env bash
# Wave 2 — write desktop/resources/MANIFEST.sha256 for critical binaries.
# Can be sourced (defines write_resources_manifest) or executed directly.
set -euo pipefail

if [[ -z "${SCRIPT_DIR:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if ! declare -F resolve_standalone_python >/dev/null 2>&1; then
  # shellcheck source=lib/common.sh
  source "${SCRIPT_DIR}/lib/common.sh"
fi

write_resources_manifest() {
  need_cmd find
  mkdir -p "${RESOURCES_DIR}"
  local out="${MANIFEST_FILE}"
  local tmp="${out}.tmp"
  : > "${tmp}"

  append_hash() {
    local rel="$1"
    local abs="${RESOURCES_DIR}/${rel}"
    if [[ -f "${abs}" ]] || [[ -x "${abs}" ]]; then
      # portable: hash then path relative to resources/
      local h
      h="$(sha256_file "${abs}")"
      printf '%s  %s\n' "${h}" "${rel}" >> "${tmp}"
      echo "    + ${rel}"
    else
      echo "    skip missing ${rel}"
    fi
  }

  echo "==> writing ${out}"

  # Python interpreter(s)
  if [[ -x "${PYTHON_RES}/bin/python3" ]]; then
    append_hash "python/bin/python3"
  fi
  if [[ -x "${PYTHON_RES}/bin/python" ]]; then
    append_hash "python/bin/python"
  fi
  if [[ -f "${PYTHON_RES}/python.exe" ]]; then
    append_hash "python/python.exe"
  fi
  # Common Windows DLL
  if [[ -f "${PYTHON_RES}/python312.dll" ]]; then
    append_hash "python/python312.dll"
  fi

  # Venv python / cfg
  if [[ -x "${VENV_RES}/bin/python" ]]; then
    # Often a symlink — hash the target file if regular, else skip content
    if [[ -f "${VENV_RES}/bin/python" ]] && [[ ! -L "${VENV_RES}/bin/python" ]]; then
      append_hash "venv/bin/python"
    elif [[ -L "${VENV_RES}/bin/python" ]]; then
      echo "    note: venv/bin/python is symlink (OK; launch via resources/python)"
    fi
  fi
  if [[ -f "${VENV_RES}/Scripts/python.exe" ]]; then
    append_hash "venv/Scripts/python.exe"
  fi
  if [[ -f "${VENV_RES}/pyvenv.cfg" ]]; then
    append_hash "venv/pyvenv.cfg"
  fi

  # Frontend
  if [[ -f "${FRONTEND_RES}/index.html" ]]; then
    append_hash "frontend/index.html"
  fi

  # Env defaults
  if [[ -f "${DEFAULT_ENV_FILE}" ]]; then
    append_hash "env/default.env"
  fi

  # Portable git (Wave 3) — critical binaries only
  if [[ -x "${RESOURCES_DIR}/git/bin/git" ]]; then
    append_hash "git/bin/git"
  fi
  if [[ -f "${RESOURCES_DIR}/git/cmd/git.exe" ]]; then
    append_hash "git/cmd/git.exe"
  fi
  if [[ -e "${RESOURCES_DIR}/git/libexec/git-core/git-remote-http" ]]; then
    append_hash "git/libexec/git-core/git-remote-http"
  fi
  if [[ -e "${RESOURCES_DIR}/git/libexec/git-core/git-remote-https" ]]; then
    append_hash "git/libexec/git-core/git-remote-https"
  fi
  # Prefer fragment from vendor-git if present (may add more paths)
  if [[ -f "${RESOURCES_DIR}/git/MANIFEST.sha256.fragment" ]]; then
    while IFS= read -r line || [[ -n "${line}" ]]; do
      [[ -z "${line}" || "${line}" =~ ^# ]] && continue
      local h rel
      h="$(awk '{print $1}' <<<"${line}")"
      rel="$(awk '{print $2}' <<<"${line}")"
      [[ -z "${h}" || -z "${rel}" ]] && continue
      if ! grep -q "  ${rel}\$" "${tmp}" 2>/dev/null; then
        printf '%s  %s\n' "${h}" "${rel}" >> "${tmp}"
        echo "    + ${rel} (from git fragment)"
      fi
    done < "${RESOURCES_DIR}/git/MANIFEST.sha256.fragment"
  fi

  # Launchers
  if [[ -f "${RESOURCES_DIR}/run-langflow.sh" ]]; then
    append_hash "run-langflow.sh"
  fi
  if [[ -f "${RESOURCES_DIR}/run-langflow.ps1" ]]; then
    append_hash "run-langflow.ps1"
  fi

  # Sort for stable diffs
  sort -k2 "${tmp}" > "${out}"
  rm -f "${tmp}"
  echo "OK: $(wc -l < "${out}") entries → ${out}"
}

# Direct execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  write_resources_manifest
fi
