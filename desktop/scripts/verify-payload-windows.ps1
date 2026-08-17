# Gate NSIS builds: confirm startup + native-DLL patches are present in resources/.
#
# Usage:
#   .\desktop\scripts\verify-payload-windows.ps1
#   .\desktop\scripts\verify-payload-windows.ps1 -SmokeOnly   # skip onnx/markitdown import
#
# Called from freeze-venv.ps1 (post-freeze) and build-windows.ps1 (pre-tauri build).

[CmdletBinding()]
param(
    [switch]$SmokeOnly,
    [string]$ResourcesDir = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ResourcesDir) {
    $ResourcesDir = (Resolve-Path (Join-Path $ScriptDir "..\resources")).Path
}

$failures = [System.Collections.Generic.List[string]]::new()

function Fail([string]$Msg) {
    $failures.Add($Msg)
    Write-Host "FAIL: $Msg" -ForegroundColor Red
}

function Pass([string]$Msg) {
    Write-Host "OK: $Msg" -ForegroundColor Green
}

function Require-File([string]$Rel, [string]$Label = "") {
    $abs = Join-Path $ResourcesDir $Rel
    if (-not (Test-Path -LiteralPath $abs)) {
        $name = if ($Label) { $Label } else { $Rel }
        Fail("missing ${name}: $abs")
        return $false
    }
    return $true
}

function Require-ContentMatch([string]$Rel, [string]$Pattern, [string]$Label) {
    $abs = Join-Path $ResourcesDir $Rel
    if (-not (Test-Path -LiteralPath $abs)) {
        Fail("missing $Label file: $abs")
        return
    }
    $text = Get-Content -LiteralPath $abs -Raw -ErrorAction SilentlyContinue
    if ($text -notmatch $Pattern) {
        Fail("$Label patch not found in $Rel (expected pattern: $Pattern)")
    } else {
        Pass("$Label present in $Rel")
    }
}

Write-Host "==> verify payload patches under $ResourcesDir"

# --- Shipped sidecar env (fast startup) ---
$envRel = "env\default.env"
if (Require-File $envRel "default.env") {
    $envText = Get-Content -LiteralPath (Join-Path $ResourcesDir $envRel) -Raw
    foreach ($pair in @(
            @("LANGFLOW_SKIP_EXTENSION_COMPONENTS", "true"),
            @("LANGFLOW_CREATE_STARTER_PROJECTS", "false"),
            @("LANGFLOW_UPDATE_STARTER_PROJECTS", "false"),
            @("LANGFLOW_LAZY_LOAD_COMPONENTS", "true"),
            @("LANGFLOW_AGENTIC_EXPERIENCE", "false")
        )) {
        $key, $val = $pair
        if ($envText -notmatch "(?m)^$key=$val\s*$") {
            Fail("default.env must set $key=$val for desktop fast-startup contract")
        }
    }
    if ($failures.Count -eq 0 -or ($failures | Where-Object { $_ -match "default.env" }).Count -eq 0) {
        Pass("default.env fast-startup keys")
    }
}

# --- Boot script: onnxruntime preload before Langflow import ---
$bootRel = "_langflow_boot.py"
if (Require-File $bootRel "boot script") {
    $bootPath = Join-Path $ResourcesDir $bootRel
    $bytes = [System.IO.File]::ReadAllBytes($bootPath)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Fail("_langflow_boot.py must be UTF-8 without BOM (breaks python exec on some hosts)")
    }
    Require-ContentMatch $bootRel "_register_native_dll_dirs" "onnx boot: register_native_dll_dirs"
    Require-ContentMatch $bootRel "ctypes\.CDLL" "onnx boot: ctypes.CDLL preload"
    Require-ContentMatch $bootRel "onnxruntime\.dll" "onnx boot: bundled onnxruntime.dll path"
}

# --- MSVC runtime vendored next to standalone python ---
if (Require-File "python\msvcp140.dll" "MSVC msvcp140") {
    Pass("vendored msvcp140.dll under resources/python")
}
if (Require-File "python\vcruntime140.dll" "MSVC vcruntime140") {
    Pass("vendored vcruntime140.dll under resources/python")
}

# --- Frozen lfx patches (extension skip + lazy-load base-path guard) ---
$lfxRel = "venv\Lib\site-packages\lfx\interface\components.py"
if (-not $SmokeOnly) {
    Require-ContentMatch $lfxRel "LANGFLOW_SKIP_EXTENSION_COMPONENTS" "lfx: extension skip gate"
    Require-ContentMatch $lfxRel "Never re-scan BASE_COMPONENTS_PATH" "lfx: lazy-load base-path guard"
}

# --- Runtime smoke: boot DLL registration + markitdown under inherited PATH ---
if (-not $SmokeOnly) {
    $py = Join-Path $ResourcesDir "python\python.exe"
    $site = Join-Path $ResourcesDir "venv\Lib\site-packages"
    $ort = Join-Path $site "onnxruntime\capi"
    if ((Test-Path -LiteralPath $py) -and (Test-Path -LiteralPath $ort)) {
        $siteEsc = $site.Replace("\", "\\")
        $ortEsc = $ort.Replace("\", "\\")
        $pyDirEsc = (Join-Path $ResourcesDir "python").Replace("\", "\\")
        $code = @"
import ctypes, os, site
from pathlib import Path
_root = Path(r'$($ResourcesDir.Replace('\','\\'))')
_site = Path(r'$siteEsc')
_ort_capi = Path(r'$ortEsc')
_python = Path(r'$pyDirEsc')
for directory in (_ort_capi, _python):
    if directory.is_dir():
        os.add_dll_directory(str(directory))
ctypes.CDLL(str(_ort_capi / 'onnxruntime.dll'))
site.addsitedir(str(_site))
import markitdown, onnxruntime
print('SMOKE_OK', onnxruntime.__version__)
"@
        $out = & $py -c $code 2>&1
        if ($LASTEXITCODE -ne 0 -or ($out -join "`n") -notmatch "SMOKE_OK") {
            Fail("onnx/markitdown import smoke failed (boot DLL registration): $out")
        } else {
            Pass("onnx/markitdown import smoke with inherited PATH")
        }
    } else {
        Fail("onnx smoke skipped: missing python.exe or onnxruntime/capi")
    }
} else {
    Write-Host "    (SmokeOnly: skipping lfx + onnx runtime smokes)"
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "======== PAYLOAD VERIFY FAILED ($($failures.Count) issue(s)) ========" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

Write-Host "======== PAYLOAD VERIFY PASS ========"
exit 0
