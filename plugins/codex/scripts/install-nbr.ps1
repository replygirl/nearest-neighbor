# install-nbr.ps1 — idempotent installer for the nbr binary (Windows)
# Shared between Claude and Codex plugins.
#
# Usage: install-nbr.ps1 [-InstallDir <path>]
#   InstallDir: directory to place the nbr binary (default: $env:CLAUDE_PLUGIN_DATA\bin)
#
# NOTE: GitHub Releases for nbr are produced by the cargo-dist CI pipeline.
# If the release/asset does not yet exist, this script prints a friendly notice
# and exits 0 (it does NOT hard-fail the hook).

param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$NbrVersion = if ($env:NBR_VERSION) { $env:NBR_VERSION } else { "0.1.0" }
$Repo = "replygirl/nearest-neighbor"
$GhReleaseTag = "cli-v$NbrVersion"
$Triple = "x86_64-pc-windows-msvc"
$Asset = "nbr-$Triple.zip"
$DownloadUrl = "https://github.com/$Repo/releases/download/$GhReleaseTag/$Asset"

# Resolve install dir
if ($InstallDir -eq "") {
  if ($env:CLAUDE_PLUGIN_DATA) {
    $InstallDir = Join-Path $env:CLAUDE_PLUGIN_DATA "bin"
  } elseif ($env:PLUGIN_DATA) {
    $InstallDir = Join-Path $env:PLUGIN_DATA "bin"
  } else {
    Write-Host "[nearest-neighbor] ERROR: InstallDir not specified and CLAUDE_PLUGIN_DATA/PLUGIN_DATA not set."
    exit 1
  }
}

$NbrBin = Join-Path $InstallDir "nbr.exe"

# ── Idempotency check ──────────────────────────────────────────────────────────
if (Test-Path $NbrBin) {
  try {
    $InstalledVersion = (& $NbrBin --version 2>$null) -split '\s+' | Select-Object -Last 1
    if ($InstalledVersion -eq $NbrVersion) {
      Write-Host "[nearest-neighbor] nbr $NbrVersion already installed at $NbrBin. Skipping."
      exit 0
    }
  } catch {
    # Version check failed — proceed with install
  }
}

Write-Host "[nearest-neighbor] Installing nbr $NbrVersion for $Triple..."

# ── Create install dir ─────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ── Download ───────────────────────────────────────────────────────────────────
$TmpDir = [System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid().ToString()
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
$Archive = Join-Path $TmpDir $Asset

try {
  $Response = Invoke-WebRequest -Uri $DownloadUrl -OutFile $Archive -PassThru -ErrorAction SilentlyContinue
  $StatusCode = $Response.StatusCode
} catch {
  $StatusCode = $_.Exception.Response.StatusCode.value__
}

if ($StatusCode -ne 200 -or -not (Test-Path $Archive)) {
  Write-Host "[nearest-neighbor] nbr $NbrVersion release not yet available (HTTP $StatusCode)."
  Write-Host "[nearest-neighbor] GitHub Releases are produced by the cargo-dist CI pipeline — check back after the first release."
  Write-Host "[nearest-neighbor] To install from source: cd nearest-neighbor/apps/cli; cargo install --path ."
  Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
  exit 0
}

# ── Extract ────────────────────────────────────────────────────────────────────
try {
  Expand-Archive -Path $Archive -DestinationPath $TmpDir -Force
} catch {
  Write-Host "[nearest-neighbor] Failed to extract archive: $_"
  Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
  exit 0
}

# Find binary
$NbrExtracted = Get-ChildItem -Path $TmpDir -Recurse -Filter "nbr.exe" | Select-Object -First 1
if (-not $NbrExtracted) {
  Write-Host "[nearest-neighbor] Could not find nbr.exe in downloaded archive."
  Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
  exit 0
}

# Install
Copy-Item -Path $NbrExtracted.FullName -Destination $NbrBin -Force

# ── Verify ─────────────────────────────────────────────────────────────────────
try {
  $VerifiedVersion = (& $NbrBin --version 2>$null) -split '\s+' | Select-Object -Last 1
  if ($VerifiedVersion -eq $NbrVersion) {
    Write-Host "[nearest-neighbor] nbr $NbrVersion installed successfully at $NbrBin."
  } else {
    Write-Host "[nearest-neighbor] WARNING: installed nbr reports version '$VerifiedVersion' (expected '$NbrVersion')."
  }
} catch {
  Write-Host "[nearest-neighbor] WARNING: could not verify installed nbr version."
}

# ── Cleanup ────────────────────────────────────────────────────────────────────
Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
