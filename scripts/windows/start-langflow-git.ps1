#!/usr/bin/env pwsh
# Langflow Desktop (Git-SoT) — Windows start script (Wave 10 / Phase 6).
# Packager default: start scripts + zip. Tauri shell is optional later.
# Edit LANGFLOW_GIT_* placeholders (or set machine env) before first launch.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
Set-Location $projectRoot

function Set-DefaultEnv([string]$Name, [string]$Value) {
    if (-not (Test-Path "Env:$Name") -or [string]::IsNullOrWhiteSpace((Get-Item "Env:$Name").Value)) {
        Set-Item -Path "Env:$Name" -Value $Value
    }
}

# ---------- Git-SoT env (placeholders) ----------
Set-DefaultEnv "LANGFLOW_GIT_ENABLED" "true"
# Required: absolute path to flows-only git working tree (flows\ + flows.lock)
Set-DefaultEnv "LANGFLOW_GIT_FLOWS_DIR" "C:\langflow-flows"
Set-DefaultEnv "LANGFLOW_GIT_AUTO_COMMIT" "false"
# Optional PAT fallback when keyring empty (prefer Git panel → Git Auth):
# Set-DefaultEnv "LANGFLOW_GIT_PAT" "glpat-REPLACE_ME"
# Set-DefaultEnv "LANGFLOW_GIT_LEASE_TTL_SECONDS" "300"

Set-DefaultEnv "LANGFLOW_AUTO_LOGIN" "true"
Set-DefaultEnv "LANGFLOW_HOST" "127.0.0.1"
Set-DefaultEnv "LANGFLOW_PORT" "7860"

Write-Host ""
Write-Host "=== Langflow Desktop Git-SoT ===" -ForegroundColor Green
Write-Host "PROJECT_ROOT=$projectRoot"
Write-Host "LANGFLOW_GIT_ENABLED=$env:LANGFLOW_GIT_ENABLED"
Write-Host "LANGFLOW_GIT_FLOWS_DIR=$env:LANGFLOW_GIT_FLOWS_DIR"
Write-Host "LANGFLOW_GIT_AUTO_COMMIT=$env:LANGFLOW_GIT_AUTO_COMMIT"
Write-Host "Host=$env:LANGFLOW_HOST Port=$env:LANGFLOW_PORT"
Write-Host ""

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Git not found on PATH." -ForegroundColor Red
    Write-Host "Install Git for Windows: https://git-scm.com/download/win"
    Write-Host "Then reopen this shell so PATH refreshes."
    exit 1
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: uv not found on PATH." -ForegroundColor Red
    Write-Host "Install: https://docs.astral.sh/uv/getting-started/installation/"
    exit 1
}

$feCandidates = @(
    (Join-Path $projectRoot "src\backend\base\langflow\frontend"),
    (Join-Path $projectRoot "src\frontend\build"),
    (Join-Path $projectRoot "src\frontend\dist")
)
$frontendPath = $null
foreach ($cand in $feCandidates) {
    if (Test-Path (Join-Path $cand "index.html")) {
        $frontendPath = $cand
        break
    }
}

if (-not $frontendPath) {
    Write-Host "WARNING: frontend build not found. Run scripts\windows\build_frontend_only.ps1 or: make build_frontend" -ForegroundColor Yellow
    Write-Host "Continuing without --frontend-path."
}

$envArgs = @()
$envFile = Join-Path $projectRoot ".env"
if (Test-Path $envFile) {
    Write-Host "Using .env at $envFile" -ForegroundColor Cyan
    $envArgs = @("--env-file", ".env")
}

Write-Host "Starting langflow..."
Write-Host "First-launch: open Git panel → Connect wizard (clone flows template / set PAT)."
Write-Host "See scripts\windows\README.md for checklist."
Write-Host ""

$runArgs = @(
    "run", "langflow", "run",
    "--host", $env:LANGFLOW_HOST,
    "--port", $env:LANGFLOW_PORT
) + $envArgs

if ($frontendPath) {
    $runArgs += @("--frontend-path", $frontendPath)
}

& uv @runArgs
exit $LASTEXITCODE
