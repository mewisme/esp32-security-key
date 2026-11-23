<#
.SYNOPSIS
  Build and flash the MultiKeys DEVELOPMENT firmware to an ESP32-S3 N16R8 over its native USB port (Windows).

.DESCRIPTION
  Thin front end for tools/flash_dev.py, which holds every safety rule. It writes only the bootloader (0x0), the
  partition table (0x8000) and the app (0x20000); the credential store, nvs, phy_init and eFuses are never touched.
  It never downloads or installs anything, never erases flash, never resets the authenticator, never sets a PIN.
  A typed confirmation (FLASH) is always required; there is no -Yes switch. -DryRun stops before writing.

.PARAMETER Port
  COM port to use. Without it exactly one ESP32-S3 download port (USB 303A:1001) is auto-detected; UART bridges are
  used only when named here.
.PARAMETER App
  fido (default) or openpgp. The openpgp image is a different product with the same storage layout; it needs
  -AcknowledgeOpenPgpImage.
.PARAMETER IdfPath
  ESP-IDF v5.5.x directory (default: $env:IDF_PATH, C:\esp\v5.5.*, $HOME\esp\v5.5.*).
.PARAMETER DryRun
  Do everything read-only (build, identify the board, check its partition table) and stop before writing.
.PARAMETER NoBuild
  Reuse the existing build-<app>-dev directory.
.PARAMETER WaitSeconds
  How long to wait for download mode (default 60).

Exit codes: 0 PASS or dry run, 1 failure, 2 prerequisite/arguments, 3 no or ambiguous device, 4 declined,
5 storage-safety stop, 6 verification FAIL.
#>
[CmdletBinding()]
param(
    [string]$Port,
    [ValidateSet('fido', 'openpgp')][string]$App = 'fido',
    [string]$IdfPath,
    [switch]$DryRun,
    [switch]$NoBuild,
    [int]$WaitSeconds = 60,
    [switch]$AcknowledgeOpenPgpImage,
    [switch]$Help
)

# Native tools write progress to stderr; under 'Stop' Windows PowerShell 5.1 would turn that into a terminating error.
$ErrorActionPreference = 'Continue'

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

$Repo = Split-Path -Parent $PSScriptRoot
$Missing = 'ESP-IDF v5.5.x not found. One-time setup: install ESP-IDF v5.5.6 (https://docs.espressif.com/projects/esp-idf/en/v5.5.6/esp32s3/get-started/windows-setup.html) then rerun, or pass -IdfPath.'

if ($env:OS -ne 'Windows_NT') {
    Write-Host 'This script is for Windows. On Linux/macOS use the manual commands in docs/FLASHING_ADVANCED.md.'
    exit 2
}

# Resolve ESP-IDF v5.5.x without installing anything.
function Find-Idf {
    $candidates = @()
    if ($IdfPath) {
        # An explicit -IdfPath is used exclusively; never silently fall back to another installation.
        $candidates += $IdfPath
    } else {
        if ($env:IDF_PATH) { $candidates += $env:IDF_PATH }
        foreach ($root in @('C:\esp', (Join-Path $HOME 'esp'))) {
            if (Test-Path $root) {
                $candidates += (Get-ChildItem -Path $root -Directory -Filter 'v5.5*' -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending | ForEach-Object { $_.FullName })
            }
        }
    }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'export.ps1')) -and (Test-Path (Join-Path $c 'tools\idf.py'))) {
            return (Resolve-Path $c).Path
        }
    }
    return $null
}

$Idf = Find-Idf
if (-not $Idf) {
    Write-Host '[1/9] prerequisites ... FAIL'
    Write-Host $Missing
    exit 2
}

$flashArgs = @('tools\flash_dev.py', 'flash', '--app', $App, '--wait', "$WaitSeconds")
if ($Port) { $flashArgs += @('--port', $Port) }
if ($DryRun) { $flashArgs += '--dry-run' }
if ($NoBuild) { $flashArgs += '--no-build' }
if ($AcknowledgeOpenPgpImage) { $flashArgs += '--ack-openpgp' }

# Run inside a child PowerShell that sources ESP-IDF, so this session's environment stays untouched.
$quoted = ($flashArgs | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ' '
$child = ". '$Idf\export.ps1' *>&1 | Out-Null; `$env:IDF_PATH = '$Idf'; Set-Location '$Repo'; python $quoted; exit `$LASTEXITCODE"
$shell = if (Get-Command powershell.exe -ErrorAction SilentlyContinue) { 'powershell.exe' } else { 'pwsh' }
& $shell -NoProfile -ExecutionPolicy Bypass -Command $child
exit $LASTEXITCODE
