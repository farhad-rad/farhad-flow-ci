# Vendor MSVC runtime DLLs into resources/python/ for a relocatable Windows payload.
#
# python-build-standalone ships vcruntime140*.dll but often not msvcp140*.dll.
# Native wheels (onnxruntime / magika / markitdown, etc.) fail on clean staff PCs
# without the VC++ redistributable with:
#   DLL load failed ... initialization routine failed
#
# Usage (from repo or via freeze/build-payload):
#   .\desktop\scripts\vendor-msvc-runtime.ps1
#
# Copies from System32 when present; otherwise from the newest VS MSVC redist folder.

[CmdletBinding()]
param(
    [string]$PythonDir = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
if (-not $PythonDir) {
    $PythonDir = Join-Path $DesktopDir "resources\python"
}

if (-not (Test-Path (Join-Path $PythonDir "python.exe"))) {
    throw "python.exe missing under $PythonDir - run fetch-python-standalone.ps1 first"
}

$needed = @(
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll",
    "msvcp140_codecvt_ids.dll",
    "concrt140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "vccorlib140.dll"
)

function Find-RedistDll([string]$Name) {
    $sys = Join-Path $env:SystemRoot "System32\$Name"
    if (Test-Path -LiteralPath $sys) { return $sys }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere) {
        $vs = & $vswhere -latest -products * -property installationPath 2>$null
        if ($vs) {
            $hit = Get-ChildItem -Path (Join-Path $vs "VC\Redist\MSVC") -Recurse -Filter $Name -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\x64\\' } |
                Sort-Object FullName -Descending |
                Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    return $null
}

Write-Host "==> vendor MSVC runtime DLLs -> $PythonDir"
$copied = 0
$missing = @()
foreach ($name in $needed) {
    $dest = Join-Path $PythonDir $name
    $src = Find-RedistDll $name
    if (-not $src) {
        # Optional variants (atomic_wait / codecvt / vccorlib) may not exist on all redists.
        if ($name -match 'atomic_wait|codecvt|vccorlib') {
            Write-Host "    skip optional missing: $name"
            continue
        }
        $missing += $name
        continue
    }
    Copy-Item -LiteralPath $src -Destination $dest -Force
    Write-Host "    + $name  (from $src)"
    $copied++
}

if ($missing.Count -gt 0) {
    throw "Missing required MSVC DLLs (install VC++ 2015-2022 x64 redistributable on the build machine): $($missing -join ', ')"
}

Write-Host "OK: vendored $copied MSVC runtime DLL(s) into $PythonDir"
