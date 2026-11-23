$env:PYTHONUNBUFFERED = '1'
Set-Location 'I:\Project\esp32\security-key'
Write-Host 'MultiKeys flash (approved). Review the confirmation block, then type FLASH.' -ForegroundColor Yellow
.\tools\flash-dev.ps1 -NoBuild 2>&1 | Tee-Object -FilePath flash-session.log
"exit=$LASTEXITCODE" | Add-Content flash-session.log
Write-Host 'Done. You can close this window.' -ForegroundColor Green
