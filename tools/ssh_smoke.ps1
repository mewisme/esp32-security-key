<#
SSH security-key smoke test for the MultiKey FIDO2 image (Windows PowerShell / pwsh).
Status: Implemented; NOT run against hardware (pending hardware). Needs a plugged-in key, button presses and the
device PIN typed at ssh-keygen's prompt. Windows may require an elevated shell for the WebAuthn path
(unverified). Changes no git/ssh config.
Usage: .\tools\ssh_smoke.ps1 -Yes
#>
param([switch]$Yes)
$ErrorActionPreference = 'Continue'
if (-not $Yes) {
    Write-Host "This creates RESIDENT credentials (application ssh:multikey-test) on the connected key and needs button presses."
    Write-Host "Re-run with -Yes to proceed. Nothing was touched."
    exit 64
}
$script:fail = 0
function Pass($m) { Write-Host "[PASS] $m" }
function Bad($m)  { Write-Host "[FAIL] $m"; $script:fail = 1 }
function Skip($m) { Write-Host "[SKIP] $m" }

$v = (& ssh -V 2>&1 | Out-String)
if ($v -notmatch 'OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)') { Write-Host "cannot parse 'ssh -V': $v"; exit 1 }
$maj = [int]$Matches[1]; $min = [int]$Matches[2]
if ($maj -lt 8 -or ($maj -eq 8 -and $min -lt 3)) {
    Write-Host "OpenSSH $maj.$min < 8.3: not supported by this script (sk keys appeared in 8.2; verify-required in 8.4)."
    exit 1
}
$vr = @('-O', 'verify-required')
if ($maj -eq 8 -and $min -lt 4) { Write-Host "note: OpenSSH $maj.$min < 8.4: omitting -O verify-required."; $vr = @() }

$eddsa = 'unknown'
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
    $code = 'from fido2.hid import CtapHidDevice; from fido2.ctap2 import Ctap2; d=next(iter(CtapHidDevice.list_devices()),None); print("unknown" if d is None else ("yes" if -8 in [a.get("alg") for a in Ctap2(d).get_info().algorithms] else "no"))'
    $out = & python -c $code 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { $eddsa = "$out".Trim() }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("mkssh-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Push-Location $tmp
try {
    Write-Host "working in $tmp (removed on exit). Resident credentials on the device are NOT removed."
    Write-Host "--- ecdsa-sk (touch the key when it blinks)"
    & ssh-keygen -t ecdsa-sk -O resident @vr -O application=ssh:multikey-test -f "$tmp\id" -N '""' -C multikey-smoke
    if ($LASTEXITCODE -eq 0) { Pass 'ssh-keygen -t ecdsa-sk (resident)' } else { Bad 'ssh-keygen -t ecdsa-sk' }

    Write-Host "--- ed25519-sk"
    if ($eddsa -eq 'yes') {
        & ssh-keygen -t ed25519-sk -O resident @vr -O application=ssh:multikey-test -f "$tmp\id_ed" -N '""' -C multikey-smoke-ed
        if ($LASTEXITCODE -eq 0) { Pass 'ssh-keygen -t ed25519-sk (resident)' } else { Bad 'ssh-keygen -t ed25519-sk' }
    } else { Skip "ed25519-sk: GetInfo EdDSA support is '$eddsa' (needs python + fido2 and a device advertising alg -8)" }

    Write-Host "--- download resident keys (ssh-keygen -K) into the temp dir"
    New-Item -ItemType Directory -Path dl | Out-Null
    Push-Location dl
    & ssh-keygen -K
    $k = $LASTEXITCODE
    Pop-Location
    if ($k -eq 0 -and (Get-ChildItem dl).Count -gt 0) { Pass 'ssh-keygen -K' } else { Bad 'ssh-keygen -K' }

    Write-Host "--- commit-style signing with the sk key (touch required)"
    if (Test-Path "$tmp\id.pub") {
        Set-Content -Path msg.txt -Value 'multikey smoke message' -NoNewline
        & ssh-keygen -Y sign -f "$tmp\id.pub" -n git msg.txt
        if ($LASTEXITCODE -eq 0 -and (Test-Path msg.txt.sig)) {
            Pass 'ssh-keygen -Y sign'
            # PowerShell cannot reliably pipe raw bytes to a native command; use cmd redirection instead.
            cmd /c "ssh-keygen -Y check-novalidate -n git -s msg.txt.sig < msg.txt"
            if ($LASTEXITCODE -eq 0) { Pass 'ssh-keygen -Y check-novalidate' } else { Bad 'ssh-keygen -Y check-novalidate' }
        } else { Bad 'ssh-keygen -Y sign' }
    } else { Skip 'sign: no id.pub (key generation failed)' }
}
finally {
    Pop-Location
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
@'

--- To use the key for Git commit signing (this script changes NO git config; run these yourself):
  git config --global gpg.format ssh
  git config --global user.signingkey C:/path/to/id_ecdsa_sk.pub
  git config --global commit.gpgsign true
  git config --global gpg.ssh.allowedSignersFile C:/path/to/allowed_signers
All results above are pending hardware until a human records them in docs/hw-reports/.
'@ | Write-Host
exit $script:fail
