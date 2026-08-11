# Wave 3 — vendor MinGit into desktop/resources/git/ (Windows)
# Reads pins from desktop/versions.lock.json (git.windows_mingit.*).
# Layout: MinGit tree (cmd/, mingw64/, usr/) under resources/git/.
# Requires: PowerShell 5+, curl or Invoke-WebRequest, Expand-Archive.
[CmdletBinding()]
param(
    [string]$DesktopDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$LockPath = Join-Path $DesktopDir "versions.lock.json"
$Dest = Join-Path $DesktopDir "resources\git"
$CacheDir = Join-Path $DesktopDir ".cache\git-src"

if (-not (Test-Path $LockPath)) {
    throw "missing $LockPath"
}

$lock = Get-Content -Raw -Path $LockPath | ConvertFrom-Json
$mg = $lock.git.windows_mingit
if (-not $mg -or -not $mg.url -or -not $mg.asset) {
    throw "git.windows_mingit.url/asset missing in versions.lock.json"
}

$Url = [string]$mg.url
$Asset = [string]$mg.asset
$ExpectedSha = [string]$mg.sha256
$Version = [string]$mg.version

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$ZipPath = Join-Path $CacheDir $Asset

Write-Host "==> Wave 3 vendor-git (Windows MinGit $Version)"
Write-Host "    url:  $Url"
Write-Host "    dest: $Dest"

if (-not (Test-Path $ZipPath)) {
    Write-Host "==> downloading $Asset"
    $partial = "$ZipPath.partial"
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
    Move-Item -Force $partial $ZipPath
} else {
    Write-Host "==> using cached $ZipPath"
}

if ($ExpectedSha) {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $ZipPath).Hash.ToLowerInvariant()
    $want = $ExpectedSha.ToLowerInvariant()
    if ($hash -ne $want) {
        throw "sha256 mismatch for $Asset`n  expected: $want`n  actual:   $hash"
    }
    Write-Host "==> sha256 OK"
}

$ExtractRoot = Join-Path $CacheDir "mingit-extract"
if (Test-Path $ExtractRoot) {
    Remove-Item -Recurse -Force $ExtractRoot
}
New-Item -ItemType Directory -Force -Path $ExtractRoot | Out-Null

Write-Host "==> extracting MinGit"
Expand-Archive -Path $ZipPath -DestinationPath $ExtractRoot -Force

# MinGit zip usually extracts cmd/, mingw64/, usr/, LICENSE.txt at top level
$HasCmd = Test-Path (Join-Path $ExtractRoot "cmd\git.exe")
if (-not $HasCmd) {
    # Sometimes nested one folder
    $nested = Get-ChildItem -Directory $ExtractRoot | Select-Object -First 1
    if ($nested -and (Test-Path (Join-Path $nested.FullName "cmd\git.exe"))) {
        $ExtractRoot = $nested.FullName
    } else {
        throw "MinGit layout unexpected: cmd\git.exe not found under extract"
    }
}

Write-Host "==> installing into $Dest"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($name in @("bin", "libexec", "share", "lib", "etc", "cmd", "mingw64", "usr")) {
    $p = Join-Path $Dest $name
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
# Clear prior stamp / fragments
foreach ($f in @(".vendor-stamp.json", "MANIFEST.sha256.fragment", "LICENSE.txt", "README.md", "README.portable.git")) {
    $p = Join-Path $Dest $f
    if (Test-Path $p) { Remove-Item -Force $p }
}

Copy-Item -Recurse -Force (Join-Path $ExtractRoot "*") $Dest

# Convenience: resources/git/bin/git.exe -> ../cmd/git.exe so Linux-style PATH prepend works too
$BinDir = Join-Path $Dest "bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$CmdGit = Join-Path $Dest "cmd\git.exe"
$BinGit = Join-Path $BinDir "git.exe"
if (Test-Path $CmdGit) {
    # Hardlink if possible; else copy
    try {
        New-Item -ItemType HardLink -Path $BinGit -Target $CmdGit -Force | Out-Null
    } catch {
        Copy-Item -Force $CmdGit $BinGit
    }
}

$MingwGitCore = Join-Path $Dest "mingw64\libexec\git-core"
$GitExecRel = if (Test-Path $MingwGitCore) { "mingw64\libexec\git-core" } else { "usr\libexec\git-core" }

$stamp = @{
    platform           = "windows"
    version            = $Version
    source             = $Url
    sha256_zip         = $ExpectedSha
    vendored_at        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    git_exec_path_rel  = $GitExecRel.Replace("\", "/")
    bin_rel            = "cmd/git.exe"
    path_prepend_rel   = @("cmd", "usr/bin", "mingw64/bin")
} | ConvertTo-Json

Set-Content -Path (Join-Path $Dest ".vendor-stamp.json") -Value $stamp -Encoding UTF8

$ManifestHelper = Join-Path $PSScriptRoot "manifest-git-entries.ps1"
if (Test-Path $ManifestHelper) {
    & $ManifestHelper | Set-Content -Path (Join-Path $Dest "MANIFEST.sha256.fragment") -Encoding ascii
}

$ver = & $CmdGit --version
Write-Host "==> vendored OK: $ver"
Write-Host "    PATH prepend: resources/git/cmd + usr/bin + mingw64/bin"
Write-Host "    GIT_EXEC_PATH -> resources/git/$($GitExecRel.Replace('\','/'))"
Write-Host "    next: verify with PATH pointing at vendored cmd (Wave 4 sidecar)"
