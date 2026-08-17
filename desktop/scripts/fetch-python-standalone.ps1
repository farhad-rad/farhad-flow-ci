# Wave 2 - download python-build-standalone into desktop/resources/python/
#
# Usage (PowerShell):
#   .\desktop\scripts\fetch-python-standalone.ps1 [-Target windows|linux]
#
# Reads pins from desktop/versions.lock.json.
# Cache: desktop/.cache/python-standalone/
#
# Windows DLL / PATH notes (also documented in SIDECAR.md):
#   Before spawning the sidecar, prepend to PATH (process-local):
#     {resources}\python\
#     {resources}\python\DLLs          (if present)
#     {resources}\venv\Scripts\
#   Native wheels (.pyd) and python3XX.dll resolve via these dirs.
#   Do NOT rely on system Python on PATH.

[CmdletBinding()]
param(
    [ValidateSet("windows", "linux")]
    [string]$Target = "windows"
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $DesktopDir "..")).Path
$LockFile = Join-Path $DesktopDir "versions.lock.json"
$ResourcesDir = Join-Path $DesktopDir "resources"
$PythonRes = Join-Path $ResourcesDir "python"
$CacheDir = Join-Path $DesktopDir ".cache\python-standalone"

if (-not (Test-Path $LockFile)) {
    throw "missing $LockFile"
}

$lock = Get-Content -Raw -Path $LockFile | ConvertFrom-Json
$targetKey = if ($Target -eq "windows") { "windows_x86_64" } else { "linux_x86_64" }
$asset = $lock.python.targets.$targetKey
$prefix = $lock.python.asset_url_prefix
$url = "$prefix/$asset"

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$archive = Join-Path $CacheDir $asset

Write-Host "==> fetch python-build-standalone"
Write-Host "    target=$targetKey"
Write-Host "    url=$url"

if (-not (Test-Path $archive)) {
    $partial = "$archive.partial"
    Invoke-WebRequest -Uri $url -OutFile $partial -UseBasicParsing
    Move-Item -Force $partial $archive
} else {
    Write-Host "    cache hit: $archive"
}

# Best-effort sha256 sidecar
$shaUrl = "$url.sha256"
$shaFile = "$archive.sha256"
try {
    Invoke-WebRequest -Uri $shaUrl -OutFile $shaFile -UseBasicParsing
    $expect = ((Get-Content $shaFile -Raw).Trim() -split "\s+")[0]
    $hash = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
    if ($expect.ToLowerInvariant() -ne $hash) {
        throw "checksum mismatch for $asset"
    }
    Write-Host "    sha256 OK"
} catch {
    Write-Host "    WARN: no verified .sha256 sidecar ($($_.Exception.Message))"
}

Write-Host "==> extract -> $PythonRes"
if (Test-Path $PythonRes) {
    Remove-Item -Recurse -Force $PythonRes
}
New-Item -ItemType Directory -Force -Path $PythonRes | Out-Null

$tmp = Join-Path $CacheDir ("extract-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    tar -xzf $archive -C $tmp
    $inner = Join-Path $tmp "python"
    if (Test-Path $inner) {
        Get-ChildItem -Force $inner | Move-Item -Destination $PythonRes -Force
    } else {
        Get-ChildItem -Force $tmp | Move-Item -Destination $PythonRes -Force
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

function Resolve-StandalonePython([string]$Root) {
    $candidates = @(
        (Join-Path $Root "python.exe"),
        (Join-Path $Root "bin\python3"),
        (Join-Path $Root "bin\python.exe"),
        (Join-Path $Root "python\python.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    throw "standalone python not found under $Root"
}

$py = Resolve-StandalonePython $PythonRes
Write-Host "==> verify interpreter: $py"
& $py -c "import sys; print(sys.version)"
if ($LASTEXITCODE -ne 0) { throw "python verify failed" }

Write-Host "OK: standalone python ready at $PythonRes"
