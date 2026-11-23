<#
Opens a NEW, visible, elevated PowerShell window and runs the interactive hardware session in it
(tools\hw_session.py). Windows shows a UAC prompt (python-fido2 needs administrator rights). The window stays open until
you press Enter at the end. Does not flash, fuse, reset or set a PIN.

  .\tools\run_hw_session.ps1 [--phases A B]   # extra arguments go to hw_session.py
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$SessionArgs)
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Missing $python (python -m venv .venv ; .\.venv\Scripts\python -m pip install -r tools\requirements.txt pyscard)" }
$cmd = "`$Host.UI.RawUI.WindowTitle = 'MultiKey hardware session'; Set-Location '$root'; & '$python' -u tools\hw_session.py $($SessionArgs -join ' ')"
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', $cmd
Write-Host 'Session window opened (accept the UAC prompt). Follow the banners in that window.'
