# Wave 6 - Windows NSIS packaging orchestrator
#
# FE bake -> python freeze -> vendor MinGit -> verify payload patches -> tauri build (nsis)
#
# Payload verify (verify-payload-windows.ps1) gates every NSIS build:
#   - default.env fast-startup keys
#   - _langflow_boot.py onnxruntime DLL preload
#   - vendored MSVC runtime + frozen lfx startup patches
#   - onnx/markitdown import smoke (full freeze only)
#
# Prerequisites (Windows x64) - auto-checked/installed at start unless -SkipDepInstall:
#   - Rust (versions.lock.json pin) via rustup
#   - MSVC link.exe (VS 2022 Build Tools C++ workload) via winget
#   - Node 22.12+ + npm via winget
#   - Git for Windows via winget (payload / bash bake)
#   - WebView2 Runtime via winget (dev/tauri; staff installer also bootstraps)
#
# Usage:
#   .\desktop\scripts\build-windows.ps1
#   .\desktop\scripts\build-windows.ps1 -SkipPayload          # reuse resources/
#   .\desktop\scripts\build-windows.ps1 -SkipNpmBuild
#   .\desktop\scripts\build-windows.ps1 -SmokeOnly            # thin freeze smoke + build
#   .\desktop\scripts\build-windows.ps1 -SkipDepInstall       # check only; no winget/rustup install
#
# Output (canonical staff name):
#   desktop/dist/FarhadFlowCI_<version>_x64-setup.exe
# Tauri default (spaces) is renamed; see STAFF_INSTALL.md.

[CmdletBinding()]
param(
    [switch]$SkipPayload,
    [switch]$SkipNpmBuild,
    [switch]$SmokeOnly,
    [switch]$SkipFreeze,
    [switch]$SkipDepInstall
)

$ErrorActionPreference = "Stop"
# PS 7.3+: ignore native-stderr-as-error. PS 7.2 lacks this preference, so native
# calls that chatter on stderr (rustup/npm) use Invoke-QuietNative below.
if ($PSVersionTable.PSVersion -ge [version]"7.3") {
    $PSNativeCommandUseErrorActionPreference = $false
}
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $DesktopDir "..")).Path
$SrcTauri = Join-Path $DesktopDir "src-tauri"
$DistDir = Join-Path $DesktopDir "dist"

Write-Host "======== Farhad Flow CI - Windows NSIS build ========"
Write-Host "desktop: $DesktopDir"

# ---------------------------------------------------------------------------
# 0) Toolchain: check + install missing deps (Rust / MSVC / Node / Git / WebView2)
# ---------------------------------------------------------------------------
function Refresh-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ";"
}

# Run a native exe without PS 7.2 treating stderr info lines as terminating errors.
function Invoke-QuietNative {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Script,
        [switch]$IgnoreExitCode
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Script 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.ToString()
            } else {
                Write-Host $_
            }
        }
        if (-not $IgnoreExitCode -and $LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
            throw "native command failed (exit $LASTEXITCODE)"
        }
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Test-ExeOnPath([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-VersionsLock {
    $lockPath = Join-Path $DesktopDir "versions.lock.json"
    if (-not (Test-Path $lockPath)) {
        throw "Missing versions.lock.json at $lockPath"
    }
    return Get-Content -Raw -Path $lockPath | ConvertFrom-Json
}

function Invoke-WingetInstall {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [string]$Version = "",
        [string]$Override = ""
    )
    if (-not (Test-ExeOnPath "winget")) {
        throw "winget missing - install App Installer from Microsoft Store, then re-run."
    }
    $args = @(
        "install", "--id", $Id,
        "--accept-package-agreements", "--accept-source-agreements",
        "-e", "--disable-interactivity"
    )
    if ($Version) { $args += @("--version", $Version) }
    if ($Override) { $args += @("--override", $Override) }
    Write-Host "    winget $($args -join ' ')"
    & winget @args
    # winget exit 0 = ok; -1978335189 / 0x8A15002B often = already installed
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
        throw "winget install failed for $Id (exit $LASTEXITCODE)"
    }
    Refresh-SessionPath
}

function Get-NodeMajorMinorPatch {
    if (-not (Test-ExeOnPath "node")) { return $null }
    $raw = (& node -v 2>$null)
    if (-not $raw) { return $null }
    $m = [regex]::Match([string]$raw, "v?(\d+)\.(\d+)\.(\d+)")
    if (-not $m.Success) { return $null }
    return [version]"$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value)"
}

function Test-NodeAtLeast([version]$Need) {
    $have = Get-NodeMajorMinorPatch
    if (-not $have) { return $false }
    return ($have -ge $Need)
}

function Test-MsvcLinker {
    if (Test-ExeOnPath "link.exe") { return $true }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $install = & $vswhere -latest -products * `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath 2>$null
        if ($install) {
            $linkCandidates = Get-ChildItem -Path $install -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match "Hostx64\\x64\\link\.exe$" } |
                Select-Object -First 1
            if ($linkCandidates) {
                $bin = $linkCandidates.Directory.FullName
                if ($env:Path -notlike "*$bin*") {
                    $env:Path = "$bin;$env:Path"
                }
                return $true
            }
        }
    }
    return $false
}

function Test-WebView2Runtime {
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    foreach ($k in $keys) {
        if (Test-Path $k) {
            $pv = (Get-ItemProperty -Path $k -ErrorAction SilentlyContinue).pv
            if ($pv) { return $true }
        }
    }
    return $false
}

function Ensure-BuildPrereqs {
    param([bool]$AllowInstall)

    Write-Host "==> check build prereqs (Rust / MSVC / Node / Git / WebView2)"
    $lock = Get-VersionsLock
    $rustPin = [string]$lock.rust.version
    if (-not $rustPin) { $rustPin = "1.90.0" }
    $nodePinStr = [string]$lock.node.version
    if (-not $nodePinStr) { $nodePinStr = "22.12.0" }
    $nodeNeed = [version]$nodePinStr
    Write-Host "    pins: rust=$rustPin node>=$nodePinStr (from versions.lock.json)"

    # --- Rust / cargo ---
    $needRustInstall = -not (Test-ExeOnPath "rustc") -or -not (Test-ExeOnPath "cargo")
    if (-not $needRustInstall) {
        $haveRust = (& rustc --version 2>$null)
        Write-Host "    rustc: $haveRust"
        if ($haveRust -notmatch [regex]::Escape($rustPin)) {
            Write-Host "    WARN: rustc not exactly $rustPin - will try rustup toolchain install"
            $needRustInstall = $true
        }
    }
    if ($needRustInstall) {
        if (-not $AllowInstall) {
            throw "Rust $rustPin missing/mismatch. Install rustup or drop -SkipDepInstall."
        }
        if (-not (Test-ExeOnPath "rustup")) {
            Write-Host "    installing rustup..."
            $tmp = Join-Path $env:TEMP "rustup-init-farhadflow.exe"
            $url = "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
            Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
            & $tmp -y --default-toolchain $rustPin --profile minimal
            if ($LASTEXITCODE -ne 0) { throw "rustup-init failed (exit $LASTEXITCODE)" }
            Remove-Item -Force $tmp -ErrorAction SilentlyContinue
            Refresh-SessionPath
            $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
            $cargoBin = Join-Path $cargoHome "bin"
            if ($env:Path -notlike "*$cargoBin*") {
                $env:Path = "$cargoBin;$env:Path"
            }
        }
        Write-Host "    rustup toolchain install $rustPin"
        Invoke-QuietNative { & rustup toolchain install $rustPin }
        Invoke-QuietNative { & rustup default $rustPin }
        Invoke-QuietNative { & rustup target add x86_64-pc-windows-msvc }
        Refresh-SessionPath
        Write-Host "    rustc: $(& rustc --version)"
    } else {
        # Ensure windows-msvc target even when rustc already present
        if (Test-ExeOnPath "rustup") {
            Invoke-QuietNative -IgnoreExitCode { & rustup target add x86_64-pc-windows-msvc }
        }
    }

    # --- MSVC linker (required for windows-msvc) ---
    if (-not (Test-MsvcLinker)) {
        if (-not $AllowInstall) {
            throw "MSVC link.exe missing. Install VS 2022 Build Tools (C++), or drop -SkipDepInstall."
        }
        Write-Host "    installing VS 2022 Build Tools (VCTools) via winget - may need admin..."
        $override = "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
        try {
            Invoke-WingetInstall -Id "Microsoft.VisualStudio.2022.BuildTools" -Override $override
        } catch {
            throw "MSVC install failed: $_. Install manually: https://visualstudio.microsoft.com/visual-cpp-build-tools/ (Desktop development with C++)"
        }
        Refresh-SessionPath
        if (-not (Test-MsvcLinker)) {
            throw "MSVC still missing after winget. Open 'x64 Native Tools' prompt or reboot, then re-run."
        }
    }
    Write-Host "    MSVC link.exe: OK"

    # --- Node + npm ---
    if (-not (Test-NodeAtLeast $nodeNeed)) {
        $have = Get-NodeMajorMinorPatch
        if ($have) {
            Write-Host "    node too old: v$have (need >= v$nodePinStr)"
        } else {
            Write-Host "    node missing"
        }
        if (-not $AllowInstall) {
            throw "Node >= $nodePinStr required. Install Node or drop -SkipDepInstall."
        }
        Write-Host "    installing Node.js LTS via winget..."
        try {
            Invoke-WingetInstall -Id "OpenJS.NodeJS.LTS"
        } catch {
            Write-Host "    LTS id failed; trying OpenJS.NodeJS..."
            Invoke-WingetInstall -Id "OpenJS.NodeJS"
        }
        Refresh-SessionPath
        if (-not (Test-NodeAtLeast $nodeNeed)) {
            $have2 = Get-NodeMajorMinorPatch
            throw "Node still < $nodePinStr after install (have=$have2). Install Node $nodePinStr+ manually from https://nodejs.org/"
        }
    }
    Write-Host "    node: $(& node -v)  npm: $(& npm -v)"

    # --- Git (vendor MinGit download + optional bash FE bake) ---
    if (-not (Test-ExeOnPath "git")) {
        if (-not $AllowInstall) {
            throw "git missing on PATH. Install Git for Windows or drop -SkipDepInstall."
        }
        Write-Host "    installing Git.Git via winget..."
        Invoke-WingetInstall -Id "Git.Git"
        Refresh-SessionPath
        if (-not (Test-ExeOnPath "git")) {
            throw "git still missing after winget. Install from https://git-scm.com/download/win"
        }
    }
    Write-Host "    git: $(& git --version)"

    # --- WebView2 (tauri build / local run) ---
    if (-not (Test-WebView2Runtime)) {
        if ($AllowInstall) {
            Write-Host "    installing Microsoft Edge WebView2 Runtime via winget..."
            try {
                Invoke-WingetInstall -Id "Microsoft.EdgeWebView2Runtime"
            } catch {
                Write-Host "    WARN: WebView2 install failed - continue; staff NSIS can bootstrap. $_"
            }
        } else {
            Write-Host "    WARN: WebView2 Runtime not detected (-SkipDepInstall)."
        }
    } else {
        Write-Host "    WebView2 Runtime: OK"
    }

    Write-Host "==> prereqs OK"
}

Ensure-BuildPrereqs -AllowInstall:(-not $SkipDepInstall)

# --- 1) Payload: FE + python + venv + MinGit ---
if (-not $SkipPayload) {
    Write-Host "==> payload (FE / python / venv)"
    $payloadArgs = @()
    if ($SmokeOnly) { $payloadArgs += "-SmokeOnly" }
    if ($SkipNpmBuild) { $payloadArgs += "-SkipNpmBuild" }
    if ($SkipFreeze) { $payloadArgs += "-SkipFreeze" }
    & (Join-Path $ScriptDir "build-payload-windows.ps1") @payloadArgs
    if ($LASTEXITCODE -ne 0) { throw "build-payload-windows.ps1 failed" }

    Write-Host "==> vendor MinGit"
    & (Join-Path $ScriptDir "vendor-git.ps1") -DesktopDir $DesktopDir
    if ($LASTEXITCODE -ne 0) { throw "vendor-git.ps1 failed" }

    Write-Host "==> refresh MANIFEST.sha256 (incl. MinGit)"
    & (Join-Path $ScriptDir "write-manifest.ps1")
    if ($LASTEXITCODE -ne 0) { throw "write-manifest.ps1 failed" }
} else {
    Write-Host "==> SkipPayload - using existing desktop/resources/"
    $crit = @(
        (Join-Path $DesktopDir "resources\python"),
        (Join-Path $DesktopDir "resources\frontend\index.html"),
        (Join-Path $DesktopDir "resources\git")
    )
    foreach ($p in $crit) {
        if (-not (Test-Path $p)) {
            throw "SkipPayload but missing required path: $p"
        }
    }
}

# --- 1b) Verify startup + DLL patches (fail fast before long NSIS compile) ---
Write-Host "==> verify payload patches (startup env, lfx, onnx boot)"
$verifyScript = Join-Path $ScriptDir "verify-payload-windows.ps1"
$resourcesDir = Join-Path $DesktopDir "resources"
if ($SmokeOnly) {
    & $verifyScript -ResourcesDir $resourcesDir -SmokeOnly
} else {
    & $verifyScript -ResourcesDir $resourcesDir
}
if ($LASTEXITCODE -ne 0) { throw "verify-payload-windows.ps1 failed — rebuild payload (no -SkipPayload) or refresh resources/" }

# --- 2) Read version from tauri.conf.json ---
$ConfPath = Join-Path $SrcTauri "tauri.conf.json"
$conf = Get-Content -Raw -Path $ConfPath | ConvertFrom-Json
$Version = [string]$conf.version
if (-not $Version) { throw "tauri.conf.json missing version" }
Write-Host "==> version $Version"

# --- 3) npm deps + tauri build (NSIS only on this host) ---
Push-Location $DesktopDir
try {
    if (-not (Test-Path (Join-Path $DesktopDir "node_modules\@tauri-apps\cli"))) {
        Write-Host "==> npm install (desktop/)"
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }

    Write-Host "==> tauri build --bundles nsis"
    # Force NSIS only so Linux agents / dual-target conf do not attempt deb here
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
    Pop-Location
}

# --- 4) Locate + rename setup.exe ---
# Tauri default: "{productName}_{version}_x64-setup.exe" -> "Farhad Flow CI_0.1.0_x64-setup.exe"
# Canonical: FarhadFlowCI_X.Y.Z_x64-setup.exe
$NsisOutCandidates = @(
    (Join-Path $SrcTauri "target\x86_64-pc-windows-msvc\release\bundle\nsis"),
    (Join-Path $SrcTauri "target\release\bundle\nsis")
)
if ($env:CARGO_TARGET_DIR) {
    $NsisOutCandidates = @(
        (Join-Path $env:CARGO_TARGET_DIR "release\bundle\nsis"),
        (Join-Path $env:CARGO_TARGET_DIR "x86_64-pc-windows-msvc\release\bundle\nsis")
    ) + $NsisOutCandidates
}
$NsisDir = $null
foreach ($c in $NsisOutCandidates) {
    if (Test-Path $c) { $NsisDir = $c; break }
}
if (-not $NsisDir) {
    throw "NSIS output dir not found under src-tauri/target/**/bundle/nsis"
}

$SetupFiles = Get-ChildItem -Path $NsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue
if (-not $SetupFiles -or $SetupFiles.Count -eq 0) {
    throw "No *-setup.exe in $NsisDir"
}
$RawSetup = $SetupFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "==> Tauri produced: $($RawSetup.FullName)"

$CanonicalName = "FarhadFlowCI_${Version}_x64-setup.exe"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$CanonicalPath = Join-Path $DistDir $CanonicalName
Copy-Item -Force $RawSetup.FullName $CanonicalPath

# Also keep a release-channel alias (Wave 0 naming)
$ChannelAlias = "FarhadFlowCI-desktop-v${Version}-windows-nsis.exe"
Copy-Item -Force $CanonicalPath (Join-Path $DistDir $ChannelAlias)

Write-Host "======== NSIS ready ========"
Write-Host "canonical: $CanonicalPath"
Write-Host "channel:   $(Join-Path $DistDir $ChannelAlias)"
Write-Host "raw:       $($RawSetup.FullName)"
Write-Host ""
Write-Host "Next (staff VM): run installer, then .\desktop\scripts\smoke-windows.ps1"
Write-Host "Defender note: see desktop/STAFF_INSTALL.md"
