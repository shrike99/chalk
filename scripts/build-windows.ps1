<#
.SYNOPSIS
  Builds the Chalk Windows installer (desktop\dist\Chalk-Setup-<version>.exe).

.PARAMETER SkipInstall
  Don't run "npm ci" (use the node_modules you already have).

.PARAMETER Unpacked
  Build an unpacked app folder (desktop\dist\win-unpacked) instead of an installer.

.EXAMPLE
  .\scripts\build-windows.ps1
#>
param([switch]$SkipInstall, [switch]$Unpacked)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd was not found. $hint" }
}

Need node "Install Node.js 20 or newer from https://nodejs.org and open a new terminal."
Need npm  "Install Node.js 20 or newer from https://nodejs.org and open a new terminal."
$major = [int]((node --version).TrimStart("v").Split(".")[0])
if ($major -lt 20) { throw "Node.js 20 or newer is needed (found $(node --version))." }

Push-Location $root
try {
  Step "Building the interface"
  Push-Location frontend
  if (-not $SkipInstall) { npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw "npm ci failed (frontend)" } }
  npm run build; if ($LASTEXITCODE) { throw "The interface failed to build" }
  Pop-Location

  Step "Preparing the desktop app"
  Push-Location desktop
  if (-not $SkipInstall) { npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw "npm ci failed (desktop)" } }
  npm run fetch-uv; if ($LASTEXITCODE) { throw "Downloading uv failed" }

  Step "Packaging"
  $target = if ($Unpacked) { "dir" } else { "nsis" }
  npx electron-builder --win $target --x64 --publish never
  if ($LASTEXITCODE) { throw "electron-builder failed" }
  Pop-Location

  $version = (Get-Content desktop\package.json | ConvertFrom-Json).version
  $out = if ($Unpacked) { "desktop\dist\win-unpacked\Chalk.exe" } else { "desktop\dist\Chalk-Setup-$version.exe" }
  Write-Host "`nDone: $out" -ForegroundColor Green
}
finally { Pop-Location }
