# Wave 2 - orchestrate Windows payload: python fetch -> FE bake -> venv freeze -> manifest
#
# Usage:
#   .\desktop\scripts\build-payload-windows.ps1
#   .\desktop\scripts\build-payload-windows.ps1 -SmokeOnly
#   .\desktop\scripts\build-payload-windows.ps1 -SkipFreeze
#   .\desktop\scripts\build-payload-windows.ps1 -SkipNpmBuild
#
# FE bake is native PowerShell (mirrors bake-frontend.sh) so Windows builds do not
# depend on WSL/Git Bash or desktop/scripts/lib/common.sh.

[CmdletBinding()]
param(
    [switch]$SmokeOnly,
    [switch]$SkipFreeze,
    [switch]$SkipNpmBuild
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $DesktopDir "..")).Path
$FrontendDir = Join-Path $RepoRoot "src\frontend"
$BackendFe = Join-Path $RepoRoot "src\backend\base\langflow\frontend"
$FrontendRes = Join-Path $DesktopDir "resources\frontend"

Write-Host "======== Farhad Flow CI desktop payload (windows) ========"

& (Join-Path $ScriptDir "fetch-python-standalone.ps1") -Target windows
if ($LASTEXITCODE -ne 0) { throw "fetch-python-standalone failed" }

function Resolve-FrontendBuildOut {
    $build = Join-Path $FrontendDir "build"
    $dist = Join-Path $FrontendDir "dist"
    if (Test-Path (Join-Path $build "index.html")) { return $build }
    if (Test-Path (Join-Path $dist "index.html")) { return $dist }
    return $null
}

function Invoke-BakeFrontendWindows {
    if (-not (Test-Path $FrontendDir)) {
        throw "missing $FrontendDir"
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm not on PATH"
    }

    $buildOut = $null
    if ($SkipNpmBuild) {
        $buildOut = Resolve-FrontendBuildOut
        if (-not $buildOut) {
            throw "SkipNpmBuild but no src\frontend\{build,dist}\index.html"
        }
        Write-Host "==> SkipNpmBuild - using $buildOut"
    } else {
        Write-Host "==> node $(node -v) npm $(npm -v)"
        Push-Location $FrontendDir
        try {
            if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
                Write-Host "==> npm install (node_modules missing)"
                # Browser binary postinstalls hit Google CFS (often 403 by region).
                # Not needed for production Vite build.
                $env:CHROMEDRIVER_SKIP_DOWNLOAD = "true"
                $env:PUPPETEER_SKIP_DOWNLOAD = "true"
                $env:PUPPETEER_SKIP_CHROME_DOWNLOAD = "true"
                $env:PUPPETEER_SKIP_CHROME_HEADLESS_SHELL = "true"
                npm install
                if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
            }
            Write-Host "==> npm run build"
            $env:CI = ""
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
        } finally {
            Pop-Location
        }
        $buildOut = Resolve-FrontendBuildOut
        if (-not $buildOut) {
            throw "frontend build produced no index.html under build/ or dist/"
        }
    }

    Write-Host "==> sync backend package path $BackendFe"
    if (Test-Path $BackendFe) { Remove-Item -Recurse -Force $BackendFe }
    New-Item -ItemType Directory -Force -Path $BackendFe | Out-Null
    Copy-Item -Recurse -Force (Join-Path $buildOut "*") $BackendFe

    Write-Host "==> copy -> $FrontendRes"
    if (Test-Path $FrontendRes) { Remove-Item -Recurse -Force $FrontendRes }
    New-Item -ItemType Directory -Force -Path $FrontendRes | Out-Null
    Copy-Item -Recurse -Force (Join-Path $buildOut "*") $FrontendRes
    $keep = Join-Path $FrontendRes ".gitkeep"
    if (Test-Path $keep) { Remove-Item -Force $keep }

    if (-not (Test-Path (Join-Path $FrontendRes "index.html"))) {
        throw "missing $FrontendRes\index.html after bake"
    }
    Write-Host "OK: frontend baked -> $FrontendRes"
}

Invoke-BakeFrontendWindows

if ($SkipFreeze) {
    & (Join-Path $ScriptDir "write-manifest.ps1")
} else {
    $freezeArgs = @()
    if ($SmokeOnly) { $freezeArgs += "-SmokeOnly" }
    & (Join-Path $ScriptDir "freeze-venv.ps1") @freezeArgs
    if ($LASTEXITCODE -ne 0) { throw "freeze-venv failed" }
}

Write-Host "======== payload ready under desktop/resources/ ========"
