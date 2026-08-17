# Wave 2 - freeze relocatable venv into desktop/resources/venv/
#
# Usage:
#   .\desktop\scripts\freeze-venv.ps1
#   .\desktop\scripts\freeze-venv.ps1 -SkipSync
#   .\desktop\scripts\freeze-venv.ps1 -SmokeOnly
#
# Requires: fetch-python-standalone.ps1 populated resources\python\
#
# Windows PATH / DLL notes (CRITICAL for native wheels):
#   Before Tauri/shell spawns the sidecar process, set process PATH to:
#     {resources}\python;
#     {resources}\python\DLLs;          # if present
#     {resources}\venv\Scripts;
#     {existing PATH}
#   python3XX.dll, vcruntime, and extension .pyd files load via DLL search
#   order (PATH + app dir). Missing these dirs -> ImportError on numpy/etc.
#   Prefer: & "{resources}\python\python.exe" -m langflow ...
#   Do NOT rely on venv\Scripts\langflow.exe shebang-equivalent alone after relocate.
#
# Linux counterpart sets LD_LIBRARY_PATH to resources/python/lib (see freeze-venv.sh).

[CmdletBinding()]
param(
    [switch]$SkipSync,
    [switch]$SmokeOnly
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $DesktopDir "..")).Path
$ResourcesDir = Join-Path $DesktopDir "resources"
$PythonRes = Join-Path $ResourcesDir "python"
$VenvRes = Join-Path $ResourcesDir "venv"
$FrontendRes = Join-Path $ResourcesDir "frontend"

function Resolve-StandalonePython([string]$Root) {
    $candidates = @(
        (Join-Path $Root "python.exe"),
        (Join-Path $Root "bin\python3.exe"),
        (Join-Path $Root "bin\python.exe"),
        (Join-Path $Root "python\python.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return (Resolve-Path $c).Path }
    }
    throw "standalone python not found under $Root - run fetch-python-standalone.ps1 first"
}

function Get-VenvSitePackages([string]$Venv, [string]$Py) {
    $win = Join-Path $Venv "Lib\site-packages"
    if (Test-Path $win) { return $win }
    $ver = & $Py -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    $nix = Join-Path $Venv "lib\python$ver\site-packages"
    if (Test-Path $nix) { return $nix }
    throw "site-packages missing under $Venv"
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv not on PATH"
}

$py = Resolve-StandalonePython $PythonRes
Write-Host "==> freeze venv using $py"
Write-Host "    dest=$VenvRes"

if (Test-Path $VenvRes) {
    if ($SkipSync -and (Test-Path (Join-Path $VenvRes "Lib\site-packages"))) {
        Write-Host "==> -SkipSync - keeping existing venv (site-packages present)"
    } else {
        Remove-Item -Recurse -Force $VenvRes
    }
}

if (-not (Test-Path $VenvRes)) {
    Write-Host "==> creating venv"
    & $py -m venv --clear $VenvRes
    if ($LASTEXITCODE -ne 0) { throw "venv create failed" }
}

$env:UV_PROJECT_ENVIRONMENT = $VenvRes
$env:VIRTUAL_ENV = $VenvRes

# Prepend DLL search dirs for this freeze process too
$dllDirs = @(
    $PythonRes,
    (Join-Path $PythonRes "DLLs"),
    (Join-Path $VenvRes "Scripts")
) | Where-Object { Test-Path $_ }
$env:PATH = ($dllDirs -join ";") + ";" + $env:PATH

Push-Location $RepoRoot
try {
    if ($SkipSync) {
        Write-Host "==> -SkipSync - empty venv structure only"
    } elseif ($SmokeOnly) {
        Write-Host "==> -SmokeOnly - install into venv only (never mutate resources\python)"
        $venvPy = Join-Path $VenvRes "Scripts\python.exe"
        if (-not (Test-Path $venvPy)) { throw "venv python missing: $venvPy" }
        uv pip install --python $venvPy --link-mode=copy httpx GitPython
        if ($LASTEXITCODE -ne 0) { throw "smoke pip install failed" }
    } else {
        Write-Host "==> uv sync into frozen venv (workspace, no-editable, no dev)"
        # --no-editable required: sidecar uses standalone python + PYTHONPATH (no .pth processing).
        uv sync --python $py --frozen --no-dev --no-editable --link-mode=copy --project $RepoRoot
        if ($LASTEXITCODE -ne 0) { throw "uv sync failed" }
        # mcp (stdio) imports pywintypes on Windows; not always pulled by the lockfile.
        $venvPy = Join-Path $VenvRes "Scripts\python.exe"
        if (-not (Test-Path $venvPy)) { throw "venv python missing: $venvPy" }
        Write-Host "==> ensure pywin32 (Windows mcp / pywintypes)"
        uv pip install --python $venvPy --link-mode=copy pywin32
        if ($LASTEXITCODE -ne 0) { throw "pywin32 install failed" }
        # Register win32 COM DLLs into this interpreter (safe no-op if already done).
        & $venvPy -c "import pywintypes, win32api; print('pywin32 OK', pywintypes.__file__)"
        if ($LASTEXITCODE -ne 0) { throw "pywin32 import failed" }
    }
} finally {
    Pop-Location
}

# Desktop-specific lfx patches: copy from workspace into frozen site-packages so NSIS
# always ships startup fixes even if uv resolved a cached wheel without them.
if (-not $SmokeOnly) {
    $site = Get-VenvSitePackages $VenvRes $py
    if (-not $site) { throw "venv site-packages missing under $VenvRes" }
    $desktopLfxPatches = @{
        (Join-Path $RepoRoot "src\lfx\src\lfx\interface\components.py") = Join-Path $site "lfx\interface\components.py"
    }
    Write-Host "==> apply desktop lfx patches -> site-packages"
    foreach ($src in $desktopLfxPatches.Keys) {
        $dst = $desktopLfxPatches[$src]
        if (-not (Test-Path -LiteralPath $src)) { throw "missing workspace patch source: $src" }
        $dstDir = Split-Path -Parent $dst
        if (-not (Test-Path -LiteralPath $dstDir)) { throw "missing venv package dir: $dstDir" }
        Copy-Item -LiteralPath $src -Destination $dst -Force
        Write-Host "    + $(Split-Path -Leaf $src) -> $dst"
    }
    Get-ChildItem -Path (Join-Path $site "lfx\interface\__pycache__") -Filter "components*.pyc" -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

# Relocatable launcher: bootstrap processes site-packages .pth (needed for pywin32).
$bootPy = Join-Path $ResourcesDir "_langflow_boot.py"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$bootContent = @'
"""Relocatable entry: standalone python + venv site-packages (.pth aware)."""
import ctypes
import os
import runpy
import site
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent
_site = _root / "venv" / "Lib" / "site-packages"
_python = _root / "python"
_ort_capi = _site / "onnxruntime" / "capi"


def _register_native_dll_dirs() -> None:
    """Pin bundled native DLL search paths before any extension import.

    Dev machines may have a different onnxruntime.dll on PATH/System32 (observed:
    1.17 in System32 vs 1.23 bundled). Without preloading the bundled DLL, magika/
    markitdown fail when custom components import those packages.
    """
    if sys.platform != "win32":
        return
    add_dll = getattr(os, "add_dll_directory", None)
    for directory in (_ort_capi, _python):
        if directory.is_dir() and add_dll is not None:
            add_dll(str(directory))
    ort_dll = _ort_capi / "onnxruntime.dll"
    if ort_dll.is_file():
        ctypes.CDLL(str(ort_dll))


_register_native_dll_dirs()

if _site.is_dir():
    site.addsitedir(str(_site))
sys.argv[0] = "langflow"
runpy.run_module("langflow", run_name="__main__", alter_sys=True)
'@
[System.IO.File]::WriteAllText($bootPy, $bootContent, $utf8NoBom)

$launcher = Join-Path $ResourcesDir "run-langflow.ps1"
@"
# Generated by freeze-venv.ps1 - relocatable sidecar entry.
`$ErrorActionPreference = "Stop"
`$Root = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$Py = Join-Path `$Root "python\python.exe"
if (-not (Test-Path `$Py)) { `$Py = Join-Path `$Root "python\bin\python.exe" }
`$Venv = Join-Path `$Root "venv"
`$Scripts = Join-Path `$Venv "Scripts"
`$Dlls = Join-Path `$Root "python\DLLs"
`$site = Join-Path `$Venv "Lib\site-packages"
`$pywin32Sys = Join-Path `$site "pywin32_system32"
`$ortCapi = Join-Path `$site "onnxruntime\capi"
`$pathPrepend = @((Join-Path `$Root "python"), `$Dlls, `$Scripts, `$pywin32Sys, (Join-Path `$site "win32"), `$ortCapi) | Where-Object { Test-Path `$_ }
`$env:PATH = (`$pathPrepend -join ";") + ";" + `$env:PATH
`$env:VIRTUAL_ENV = `$Venv
`$env:PYTHONNOUSERSITE = "1"
# Merge defaults from resources\env\default.env (do not override already-set vars).
# LANGFLOW_GIT_FLOWS_DIR intentionally unset by default -> {config_dir}/flows-repo.
`$envFile = Join-Path `$Root "env\default.env"
if (Test-Path `$envFile) {
    Get-Content `$envFile | ForEach-Object {
        `$line = `$_.Trim()
        if (-not `$line -or `$line.StartsWith("#")) { return }
        `$eq = `$line.IndexOf("=")
        if (`$eq -lt 1) { return }
        `$k = `$line.Substring(0, `$eq).Trim()
        `$v = `$line.Substring(`$eq + 1)
        if (-not (Test-Path "Env:`$k") -or [string]::IsNullOrWhiteSpace((Get-Item "Env:`$k").Value)) {
            Set-Item -Path "Env:`$k" -Value `$v
        }
    }
}
`$boot = Join-Path `$Root "_langflow_boot.py"
if (Test-Path `$boot) {
    & `$Py `$boot @args
} else {
    if (Test-Path `$site) {
        if (`$env:PYTHONPATH) { `$env:PYTHONPATH = "`$site;`$env:PYTHONPATH" } else { `$env:PYTHONPATH = `$site }
    }
    & `$Py -m langflow @args
}
exit `$LASTEXITCODE
"@ | Set-Content -Encoding UTF8 -Path $launcher

# Size trim - never delete test/tests/testing (numpy.testing is a runtime API).
Write-Host "==> size trim excludes"
Get-ChildItem -Recurse -Force -ErrorAction SilentlyContinue $VenvRes |
    Where-Object {
        ($_.PSIsContainer -and $_.Name -in @("__pycache__", ".pytest_cache", "torch", "nvidia")) -or
        (-not $_.PSIsContainer -and $_.Extension -in @(".pyc", ".pyo"))
    } |
    ForEach-Object {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $_.FullName
    }
$siteTrim = Get-VenvSitePackages $VenvRes $py
if (Test-Path $siteTrim) {
    Get-ChildItem -Recurse -Force -Directory -ErrorAction SilentlyContinue $siteTrim |
        Where-Object { $_.Name -in @("docs", "doc", "examples", "benchmarks", "build_time") } |
        ForEach-Object {
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $_.FullName
        }
}

# Import smoke
if (-not $SkipSync) {
    Write-Host "==> import smoke"
    $venvPy = Join-Path $VenvRes "Scripts\python.exe"
    # Prevent smoke imports from regenerating __pycache__ (NSIS fails on very long .pyc paths).
    $prevDontWrite = $env:PYTHONDONTWRITEBYTECODE
    $env:PYTHONDONTWRITEBYTECODE = "1"
    try {
        if ($SmokeOnly) {
            & $venvPy -c "import httpx, git; print('smoke imports OK')"
        } else {
            $site = Get-VenvSitePackages $VenvRes $py
            $editable = Get-ChildItem -Path $site -Filter "_editable_impl_*.pth" -ErrorAction SilentlyContinue
            if ($editable) {
                throw "editable .pth still present under $site - freeze must use uv --no-editable"
            }
            # Prefer .pth-aware addsitedir (pywin32); matches _langflow_boot.py runtime contract.
            $siteEsc = $site.Replace("\", "\\")
            & $py -c "import site; site.addsitedir(r'$siteEsc'); import numpy.testing, scipy.signal, langflow, httpx, git; from langflow.main import setup_app; print('langflow OK', langflow.__file__)"
        }
        if ($LASTEXITCODE -ne 0) { throw "import smoke failed" }
    } finally {
        if ($null -eq $prevDontWrite) {
            Remove-Item Env:PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
        } else {
            $env:PYTHONDONTWRITEBYTECODE = $prevDontWrite
        }
    }
}

# Re-trim bytecode after smoke so NSIS never sees regenerated __pycache__.
Write-Host "==> re-trim bytecode after smoke"
Get-ChildItem -Recurse -Force -ErrorAction SilentlyContinue $VenvRes |
    Where-Object {
        ($_.PSIsContainer -and $_.Name -eq "__pycache__") -or
        (-not $_.PSIsContainer -and $_.Extension -in @(".pyc", ".pyo"))
    } |
    ForEach-Object {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $_.FullName
    }

# Bundle MSVC runtime next to standalone python (clean PCs lack system msvcp140).
& (Join-Path $ScriptDir "vendor-msvc-runtime.ps1") -PythonDir (Join-Path $ResourcesDir "python")
if ($LASTEXITCODE -ne 0) { throw "vendor-msvc-runtime failed" }

# Gate: startup env + lfx patches + onnx preload must be in resources before NSIS.
$verifyScript = Join-Path $ScriptDir "verify-payload-windows.ps1"
if ($SmokeOnly) {
    & $verifyScript -SmokeOnly -ResourcesDir $ResourcesDir
} else {
    & $verifyScript -ResourcesDir $ResourcesDir
}
if ($LASTEXITCODE -ne 0) { throw "verify-payload-windows failed" }

# Manifest
& (Join-Path $ScriptDir "write-manifest.ps1")
if ($LASTEXITCODE -ne 0) { throw "write-manifest failed" }

Write-Host "OK: frozen venv at $VenvRes"
Write-Host "    launch via: $launcher run --host 127.0.0.1 --port 7860 --frontend-path $FrontendRes"
