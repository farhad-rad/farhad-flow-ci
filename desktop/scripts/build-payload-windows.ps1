# Wave 2 — orchestrate Windows payload: python fetch → FE bake → venv freeze → manifest
#
# Usage:
#   .\desktop\scripts\build-payload-windows.ps1
#   .\desktop\scripts\build-payload-windows.ps1 -SmokeOnly
#   .\desktop\scripts\build-payload-windows.ps1 -SkipFreeze
#   .\desktop\scripts\build-payload-windows.ps1 -SkipNpmBuild
#
# FE bake shells out to bake-frontend.sh (Git Bash / WSL) when bash is available;
# otherwise expects an existing src\frontend\build and copies it.

[CmdletBinding()]
param(
    [switch]$SmokeOnly,
    [switch]$SkipFreeze,
    [switch]$SkipNpmBuild
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "======== Farhad Flow CI desktop payload (windows) ========"

& (Join-Path $ScriptDir "fetch-python-standalone.ps1") -Target windows
if ($LASTEXITCODE -ne 0) { throw "fetch-python-standalone failed" }

$bake = Join-Path $ScriptDir "bake-frontend.sh"
$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($bash) {
    $envArgs = @()
    if ($SkipNpmBuild) { $env:SKIP_NPM_BUILD = "1" }
    & bash $bake
    if ($LASTEXITCODE -ne 0) { throw "bake-frontend.sh failed" }
} else {
    Write-Host "WARN: bash not found — copying existing frontend build if present"
    $DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
    $RepoRoot = (Resolve-Path (Join-Path $DesktopDir "..")).Path
    $src = Join-Path $RepoRoot "src\frontend\build"
    if (-not (Test-Path (Join-Path $src "index.html"))) {
        $src = Join-Path $RepoRoot "src\frontend\dist"
    }
    if (-not (Test-Path (Join-Path $src "index.html"))) {
        throw "No frontend build and no bash to run bake-frontend.sh"
    }
    $dest = Join-Path $DesktopDir "resources\frontend"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Recurse -Force (Join-Path $src "*") $dest
}

if ($SkipFreeze) {
    & (Join-Path $ScriptDir "write-manifest.ps1")
} else {
    $freezeArgs = @()
    if ($SmokeOnly) { $freezeArgs += "-SmokeOnly" }
    & (Join-Path $ScriptDir "freeze-venv.ps1") @freezeArgs
    if ($LASTEXITCODE -ne 0) { throw "freeze-venv failed" }
}

Write-Host "======== payload ready under desktop/resources/ ========"
