# Wave 6 — post-install smoke checklist (Windows)
#
# Run AFTER installing FarhadFlowCI_*_x64-setup.exe on a Windows staff machine.
# Does not replace manual UI checks; prints launch notes + curls health.
#
# Usage:
#   .\desktop\scripts\smoke-windows.ps1
#   .\desktop\scripts\smoke-windows.ps1 -Port 7860
#   .\desktop\scripts\smoke-windows.ps1 -SkipLaunch
#   .\desktop\scripts\smoke-windows.ps1 -WaitSeconds 120

[CmdletBinding()]
param(
    [int]$Port = 7860,
    [int]$WaitSeconds = 90,
    [switch]$SkipLaunch,
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "==> $msg"
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "FarhadFlowCI"
}
$Exe = Join-Path $InstallDir "FarhadFlowCI.exe"

Write-Host "======== Farhad Flow CI — Windows smoke ========"
Write-Host "install_dir: $InstallDir"
Write-Host "exe:         $Exe"
Write-Host "health port: $Port (also try 7861..7870 if busy)"

# --- checklist print ---
Write-Step "MANUAL CHECKLIST (staff)"
@(
    "[ ] Installer ran without elevation (currentUser / LocalAppData)",
    "[ ] Start Menu → Farhad Flow CI shortcut present",
    "[ ] Optional Desktop shortcut (finish-page checkbox) if requested",
    "[ ] App window title = Farhad Flow CI; splash then UI",
    "[ ] First run: Git SoT wizard (flows-repo NOT inside install dir)",
    "[ ] Uninstall removes $InstallDir only — flows-repo under config_dir remains"
) | ForEach-Object { Write-Host "  $_" }

if (-not (Test-Path $Exe)) {
    Write-Host ""
    Write-Host "FAIL: FarhadFlowCI.exe missing at $Exe"
    Write-Host "Install FarhadFlowCI_*_x64-setup.exe first, or pass -InstallDir"
    exit 1
}
Write-Step "OK install layout — FarhadFlowCI.exe present"

if (-not $SkipLaunch) {
    Write-Step "Launch FarhadFlowCI.exe"
    Write-Host "Notes:"
    Write-Host "  - First boot: splash until sidecar READY (may take 30–90s)"
    Write-Host "  - Logs: %LANGFLOW_CONFIG_DIR%\logs\sidecar.log (or platformdirs config)"
    Write-Host "  - Dev attach: set FARHAD_FLOW_CI_DEV=1 only for staff debug"
    Start-Process -FilePath $Exe
} else {
    Write-Step "SkipLaunch — assuming app already running"
}

# --- health poll ---
Write-Step "Poll health (GET http://127.0.0.1:$Port/ …)"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ok = $false
$lastErr = $null
$urls = @(
    "http://127.0.0.1:$Port/api/v1/git/health",
    "http://127.0.0.1:$Port/health",
    "http://127.0.0.1:$Port/api/v1/health"
)

# Also scan port fallback range once base fails near deadline
$portList = @($Port) + (7860..7870 | Where-Object { $_ -ne $Port })

while ((Get-Date) -lt $deadline) {
    foreach ($p in $portList) {
        foreach ($path in @("/api/v1/git/health", "/health", "/api/v1/health")) {
            $u = "http://127.0.0.1:$p$path"
            try {
                $resp = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3
                if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                    Write-Host "OK health: $u → HTTP $($resp.StatusCode)"
                    if ($resp.Content) {
                        $snippet = $resp.Content
                        if ($snippet.Length -gt 200) { $snippet = $snippet.Substring(0, 200) + "…" }
                        Write-Host "body: $snippet"
                    }
                    $ok = $true
                    break
                }
            } catch {
                $lastErr = $_.Exception.Message
            }
        }
        if ($ok) { break }
    }
    if ($ok) { break }
    Start-Sleep -Seconds 3
    Write-Host "  … waiting for sidecar (last: $lastErr)"
}

Write-Host ""
if ($ok) {
    Write-Host "======== SMOKE PASS (health reachable) ========"
    Write-Host "Open UI in the Farhad Flow CI window (or http://127.0.0.1:$Port)."
    exit 0
} else {
    Write-Host "======== SMOKE FAIL (no health within ${WaitSeconds}s) ========"
    Write-Host "Check: $InstallDir\resources\ exists; sidecar.log under config_dir."
    if ($lastErr) { Write-Host "last error: $lastErr" }
    exit 1
}
