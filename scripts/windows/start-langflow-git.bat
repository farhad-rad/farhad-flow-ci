@echo off
setlocal EnableExtensions

REM Langflow Desktop (Git-SoT) — Windows start script (Wave 10 / Phase 6).
REM Packager default: start scripts + zip. Tauri shell is optional later.
REM Edit the LANGFLOW_GIT_* placeholders below before first launch.

for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%" || (
  echo ERROR: cannot cd to PROJECT_ROOT=%PROJECT_ROOT%
  exit /b 1
)

REM ---------- Git-SoT env (placeholders — edit for your machine) ----------
if not defined LANGFLOW_GIT_ENABLED set "LANGFLOW_GIT_ENABLED=true"
REM Required: absolute path to flows-only git working tree (contains flows\ + flows.lock)
if not defined LANGFLOW_GIT_FLOWS_DIR set "LANGFLOW_GIT_FLOWS_DIR=C:\langflow-flows"
if not defined LANGFLOW_GIT_AUTO_COMMIT set "LANGFLOW_GIT_AUTO_COMMIT=true"
REM Optional PAT fallback when OS keyring empty (prefer Git panel → Git Auth):
REM if not defined LANGFLOW_GIT_PAT set "LANGFLOW_GIT_PAT=glpat-REPLACE_ME"
REM Optional:
REM if not defined LANGFLOW_GIT_LEASE_TTL_SECONDS set "LANGFLOW_GIT_LEASE_TTL_SECONDS=300"
REM if not defined LANGFLOW_GIT_AUTO_COMMIT_DEBOUNCE_MS set "LANGFLOW_GIT_AUTO_COMMIT_DEBOUNCE_MS=1500"

REM Desktop-ish local defaults (override via machine env or .env)
if not defined LANGFLOW_AUTO_LOGIN set "LANGFLOW_AUTO_LOGIN=true"
if not defined LANGFLOW_HOST set "LANGFLOW_HOST=127.0.0.1"
if not defined LANGFLOW_PORT set "LANGFLOW_PORT=7860"

echo.
echo === Langflow Desktop Git-SoT ===
echo PROJECT_ROOT=%PROJECT_ROOT%
echo LANGFLOW_GIT_ENABLED=%LANGFLOW_GIT_ENABLED%
echo LANGFLOW_GIT_FLOWS_DIR=%LANGFLOW_GIT_FLOWS_DIR%
echo LANGFLOW_GIT_AUTO_COMMIT=%LANGFLOW_GIT_AUTO_COMMIT%
echo Host=%LANGFLOW_HOST% Port=%LANGFLOW_PORT%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git not found on PATH.
  echo Install Git for Windows: https://git-scm.com/download/win
  echo Then reopen this window so PATH refreshes.
  pause
  exit /b 1
)

where uv >nul 2>&1
if errorlevel 1 (
  echo ERROR: uv not found on PATH.
  echo Install: https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)

set "FE_PATH=%PROJECT_ROOT%\src\backend\base\langflow\frontend"
if not exist "%FE_PATH%\index.html" (
  if exist "%PROJECT_ROOT%\src\frontend\build\index.html" (
    set "FE_PATH=%PROJECT_ROOT%\src\frontend\build"
  ) else if exist "%PROJECT_ROOT%\src\frontend\dist\index.html" (
    set "FE_PATH=%PROJECT_ROOT%\src\frontend\dist"
  ) else (
    echo WARNING: frontend build not found under backend frontend\, src\frontend\build, or dist.
    echo Run scripts\windows\build_frontend_only.bat ^(or: make build_frontend^) first.
    echo Continuing without --frontend-path; langflow may serve packaged assets if present.
    set "FE_PATH="
  )
)

set "ENV_ARGS="
if exist "%PROJECT_ROOT%\.env" (
  echo Using .env at %PROJECT_ROOT%\.env
  set "ENV_ARGS=--env-file .env"
)

echo Starting langflow...
echo First-launch: open Git panel → Connect wizard ^(clone flows template / set PAT^).
echo See scripts\windows\README.md for checklist.
echo.

if defined FE_PATH (
  uv run langflow run --frontend-path "%FE_PATH%" --host %LANGFLOW_HOST% --port %LANGFLOW_PORT% %ENV_ARGS%
) else (
  uv run langflow run --host %LANGFLOW_HOST% --port %LANGFLOW_PORT% %ENV_ARGS%
)

set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo ERROR: langflow exited with code %RC%
  pause
)
endlocal & exit /b %RC%
