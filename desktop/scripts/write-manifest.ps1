# Wave 2 - write desktop/resources/MANIFEST.sha256 for critical binaries.
$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ResourcesDir = Join-Path $DesktopDir "resources"
$Out = Join-Path $ResourcesDir "MANIFEST.sha256"

function Add-Hash([string]$Rel) {
    $abs = Join-Path $ResourcesDir $Rel
    if (-not (Test-Path $abs)) {
        Write-Host "    skip missing $Rel"
        return
    }
    $h = (Get-FileHash -Algorithm SHA256 -Path $abs).Hash.ToLowerInvariant()
    Add-Content -Path $script:OutTmp -Value "$h  $Rel"
    Write-Host "    + $Rel"
}

$OutTmp = "$Out.tmp"
New-Item -ItemType Directory -Force -Path $ResourcesDir | Out-Null
Set-Content -Path $OutTmp -Value "" -Encoding ASCII

Write-Host "==> writing $Out"

$candidates = @(
    "python\python.exe",
    "python\python312.dll",
    "python\bin\python3",
    "python\bin\python",
    "venv\Scripts\python.exe",
    "venv\pyvenv.cfg",
    "frontend\index.html",
    "env\default.env",
    "_langflow_boot.py",
    "python\pythonw.exe",
    "python\msvcp140.dll",
    "git\bin\git",
    "git\cmd\git.exe",
    "run-langflow.ps1",
    "run-langflow.sh"
)

foreach ($c in $candidates) {
    Add-Hash $c
}

# Wave 3 vendor fragment (extra git-core helpers)
$frag = Join-Path $ResourcesDir "git\MANIFEST.sha256.fragment"
if (Test-Path $frag) {
    Get-Content $frag | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line -split '\s+', 2
        if ($parts.Count -lt 2) { return }
        $rel = $parts[1]
        if (-not (Select-String -Path $OutTmp -Pattern "  $($rel.Replace('\','\\'))$" -Quiet -ErrorAction SilentlyContinue)) {
            Add-Content -Path $OutTmp -Value "$($parts[0])  $rel"
            Write-Host "    + $rel (from git fragment)"
        }
    }
}

Get-Content $OutTmp |
    Where-Object { $_.Trim().Length -gt 0 } |
    Sort-Object { ($_ -split '\s+', 2)[1] } |
    Set-Content -Encoding ASCII -Path $Out
Remove-Item $OutTmp -Force
$n = @(Get-Content $Out).Count
Write-Host "OK: $n entries -> $Out"
exit 0
