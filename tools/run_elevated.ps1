<#
Runs a venv Python script in an ELEVATED PowerShell (python-fido2 needs administrator rights to open FIDO HID devices
on Windows) and saves the output as UTF-8 to a log file in the repository root.

  .\tools\run_elevated.ps1 tools\ctap_up_test.py
  .\tools\run_elevated.ps1 tools\ctap_smoke.py --skip-eddsa

Windows shows a UAC prompt unless you are already elevated. The elevated window stays open for a few seconds at the end.
It only runs the script you name; it does not flash, fuse or reset anything by itself.
#>
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Script,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ScriptArgs
)
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw "Missing $python. Run: python -m venv .venv ; .\.venv\Scripts\python -m pip install -r tools\requirements.txt"
}
$logName = ((Split-Path -Leaf $Script) -replace '\.py$', '') + '.log'
$log = Join-Path $root $logName
$inner = "Set-Location '$root'; & '$python' -u '$Script' $($ScriptArgs -join ' ') *>&1 | Out-File -Encoding utf8 '$log'; Get-Content '$log'; Start-Sleep -Seconds 8"
Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $inner
Write-Host "--- log: $log"
Get-Content $log
