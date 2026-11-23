<#
.SYNOPSIS
  OpenPGP-card smoke test for the MultiKeys `openpgp` firmware image on Windows (Gpg4win). PowerShell twin of tools/gpg_smoke.sh.
.DESCRIPTION
  Default: read-only. Runs `gpg --card-status`, parses and checks it. Changes nothing.
  -Destructive -IUnderstandThisResetsTheCard: factory-resets the card, generates RSA-2048 keys ON the card, signs/verifies,
  encrypts/decrypts, provokes one wrong-PIN try, then asks you to replug and checks that the keys survived.
  -ParseOnly FILE: checks the text of a saved `gpg --card-status` (no card, no gpg needed).

  Safety: everything runs in a throw-away GNUPGHOME under %TEMP%; your own keyring and gpg-agent are not touched. Destructive
  mode needs both switches, erases every OpenPGP and PIV object on the key (use a test key), and answers pinentry with the
  public FACTORY PINs (user 123456, admin 12345678) through tools/fake_pinentry.py. It never prints a PIN, only fingerprints.

  Status: Implemented. NOT hardware verified: no run against a real board exists (docs/TESTING.md, docs/hw-reports/).
.EXAMPLE
  ./tools/gpg_smoke.ps1
.EXAMPLE
  ./tools/gpg_smoke.ps1 -Destructive -IUnderstandThisResetsTheCard
#>
[CmdletBinding()]
param(
    [switch]$Destructive,
    [switch]$IUnderstandThisResetsTheCard,
    [switch]$NoReplug,
    [switch]$DisableCcid,
    [string]$ParseOnly,
    [switch]$Help
)

if ($Help) { Get-Help $PSCommandPath -Detailed; return }
if ($Destructive -and -not $IUnderstandThisResetsTheCard) {
    [Console]::Error.WriteLine('-Destructive erases the card; add -IUnderstandThisResetsTheCard to proceed.')
    exit 2
}
if ($IUnderstandThisResetsTheCard -and -not $Destructive) {
    [Console]::Error.WriteLine('-IUnderstandThisResetsTheCard only has a meaning together with -Destructive.')
    exit 2
}

$script:failed = $false
function Pass($m) { Write-Host "[PASS] $m" }
function Bad($m) { Write-Host "[FAIL] $m"; $script:failed = $true }
function Skip($m) { Write-Host "[SKIP] $m" }

# Field "LABEL ....: value" of the card status text.
function Get-Field([string]$Text, [string]$Label) {
    foreach ($line in ($Text -split "\r?\n")) {
        if ($line -match ('^' + [regex]::Escape($Label) + '[ .]*: *(.*)$')) { return $Matches[1].Trim() }
    }
    return ''
}

function Test-CardStatus([string]$Text) {
    $aid = (Get-Field $Text 'Application ID') -replace ' ', ''
    if ($aid -like 'D27600012401*') { Pass "Application ID is an OpenPGP card ($aid)" }
    elseif (-not $aid) { Bad 'no Application ID in the card status' }
    else { Bad "Application ID $aid is not an OpenPGP card (D27600012401...)" }
    foreach ($f in 'Manufacturer', 'Version', 'Serial number') {
        if (Get-Field $Text $f) { Pass "$f present" } else { Bad "no $f" }
    }
    $counters = Get-Field $Text 'PIN retry counter'
    if ($counters -match '^(\d+) (\d+) (\d+)$') {
        Pass "PIN retry counters (user reset admin): $counters"
        # The middle counter is the reset code; cards without one print 0 there.
        if ([int]$Matches[1] -eq 0 -or [int]$Matches[3] -eq 0) { Bad "the user or admin PIN is blocked (counter 0): $counters" }
    } else { Bad "PIN retry counter line missing or malformed: '$counters'" }
    foreach ($k in 'Signature key', 'Encryption key', 'Authentication key') {
        $v = Get-Field $Text $k
        if (-not $v) { Bad "no '$k' line" }
        elseif ($v -eq '[none]') { Write-Host "[INFO] $k`: none on the card" }
        else { Pass "$k present" }
    }
}

function Exit-Smoke { exit ([int]$script:failed) }

if ($ParseOnly) {
    if (-not (Test-Path -LiteralPath $ParseOnly)) { [Console]::Error.WriteLine("no such file: $ParseOnly"); exit 2 }
    Test-CardStatus (Get-Content -LiteralPath $ParseOnly -Raw)
    Exit-Smoke; return
}

$gpg = Get-Command gpg -ErrorAction SilentlyContinue
if (-not $gpg) { [Console]::Error.WriteLine('gpg not found (install Gpg4win)'); exit 2 }
$gpgconf = Get-Command gpgconf -ErrorAction SilentlyContinue

$home_ = Join-Path ([IO.Path]::GetTempPath()) ('multikey-gpg-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Path $home_ | Out-Null
$oldHome = $env:GNUPGHOME
$env:GNUPGHOME = $home_
$oldMode = $env:MULTIKEY_SMOKE_PIN_MODE
$ErrorActionPreference = 'Continue'   # native stderr must not become a terminating error in Windows PowerShell 5.1

function Stop-Agents([string]$What = 'all') { if ($gpgconf) { & gpgconf --kill $What 2>&1 | Out-Null } }

try {
    if ($DisableCcid) { [IO.File]::WriteAllText((Join-Path $home_ 'scdaemon.conf'), "disable-ccid`n") }
    if ($Destructive) {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if (-not $python) { [Console]::Error.WriteLine('python is needed for tools/fake_pinentry.py'); exit 2 }
        $pin = Join-Path $home_ 'pinentry-fake.cmd'
        [IO.File]::WriteAllText($pin, "@echo off`r`n`"$($python.Source)`" `"$PSScriptRoot\fake_pinentry.py`"`r`n")
        [IO.File]::WriteAllText((Join-Path $home_ 'gpg-agent.conf'), "pinentry-program $pin`nallow-loopback-pinentry`n")
    }

    function Get-CardStatus {
        $out = (& gpg --card-status 2>&1 | ForEach-Object { "$_" }) -join "`n"
        if ($LASTEXITCODE -ne 0) {
            Write-Host $out
            Bad 'gpg --card-status failed (is the openpgp image flashed and replugged? Windows needs no pcscd; try -DisableCcid if another smart-card stack holds the reader)'
            return $null
        }
        return $out
    }

    # Feeds commands to `gpg --command-fd 0 --card-edit` from a file (LF line ends, no PIN in it).
    function Invoke-CardEdit([string[]]$Commands) {
        $in = Join-Path $home_ 'cmds.txt'
        $log = Join-Path $home_ 'last.log'
        [IO.File]::WriteAllText($in, (($Commands -join "`n") + "`n"))
        & cmd.exe /c "gpg --command-fd 0 --status-fd 2 --card-edit < `"$in`" > `"$log`" 2>&1"
        return ($LASTEXITCODE -eq 0)
    }
    function Get-UserRetries([string]$Text) { return [int](((Get-Field $Text 'PIN retry counter') -split ' ')[0]) }

    Write-Host '--- gpg --card-status'
    $status = Get-CardStatus
    if ($null -eq $status) { Exit-Smoke; return }
    Write-Host $status
    Test-CardStatus $status

    if (-not $Destructive) {
        Write-Host 'Read-only run finished. Key operations: rerun with -Destructive -IUnderstandThisResetsTheCard (test key only).'
        Write-Host 'Results are not hardware verified until recorded in docs/hw-reports/.'
        Exit-Smoke; return
    }

    Write-Host '--- factory reset (erases every OpenPGP object on the card)'
    if (Invoke-CardEdit 'admin', 'factory-reset', 'y', 'yes', 'quit') { Pass 'factory-reset' } else { Get-Content "$home_\last.log"; Bad 'factory-reset'; Exit-Smoke; return }
    $status = Get-CardStatus; if ($null -eq $status) { Exit-Smoke; return }
    $c = (Get-Field $status 'PIN retry counter') -split ' '
    if ($c[0] -eq '3' -and $c[2] -eq '3') { Pass 'user and admin counters back to 3' } else { Bad "counters after reset: $($c -join ' ')" }

    Write-Host '--- generate RSA-2048 keys on the card (can take about a minute)'
    if (Invoke-CardEdit 'admin', 'generate', 'n', '0', 'y', 'MultiKeys Smoke', 'smoke@invalid.example', '', 'O', 'quit') { Pass 'on-card key generation' }
    else { Get-Content "$home_\last.log"; Bad 'on-card key generation'; Exit-Smoke; return }
    $status = Get-CardStatus; if ($null -eq $status) { Exit-Smoke; return }
    foreach ($k in 'Signature key', 'Encryption key', 'Authentication key') {
        $v = Get-Field $status $k
        if ($v -and $v -ne '[none]') { Pass "$k on the card" } else { Bad "$k missing after generate" }
    }
    $fpr = ((& gpg --with-colons --list-keys smoke@invalid.example 2>$null) | Where-Object { $_ -match '^fpr:::::::::([0-9A-F]+):$' } | Select-Object -First 1)
    if ($fpr -match '^fpr:::::::::([0-9A-F]+):$') { $fpr = $Matches[1] } else { Bad 'no public key for the generated card key'; Exit-Smoke; return }
    Write-Host "key fingerprint: $fpr"

    $work = Join-Path $home_ 'work'; New-Item -ItemType Directory -Path $work | Out-Null
    [IO.File]::WriteAllText("$work\msg.txt", "multikey gpg smoke`n")
    function Invoke-Cycle([string]$Label) {
        & gpg --batch --yes --local-user $fpr --detach-sign -o "$work\msg.sig" "$work\msg.txt" 2>&1 | Out-Null
        $signed = $LASTEXITCODE -eq 0
        & gpg --batch --verify "$work\msg.sig" "$work\msg.txt" 2>&1 | Out-Null
        if ($signed -and $LASTEXITCODE -eq 0) { Pass "${Label}: sign + verify" } else { Bad "${Label}: sign + verify" }
        & gpg --batch --yes --trust-model always --recipient $fpr -o "$work\msg.gpg" --encrypt "$work\msg.txt" 2>&1 | Out-Null
        $enc = $LASTEXITCODE -eq 0
        & gpg --batch --yes -o "$work\msg.out" --decrypt "$work\msg.gpg" 2>&1 | Out-Null
        if ($enc -and $LASTEXITCODE -eq 0 -and ((Get-FileHash "$work\msg.txt").Hash -eq (Get-FileHash "$work\msg.out").Hash)) { Pass "${Label}: encrypt + decrypt" }
        else { Bad "${Label}: encrypt + decrypt" }
        Remove-Item "$work\msg.sig", "$work\msg.gpg", "$work\msg.out" -ErrorAction SilentlyContinue
    }
    Invoke-Cycle 'after generate'

    Write-Host '--- one wrong user PIN (counter must drop by one, then recover)'
    $status = Get-CardStatus; if ($null -eq $status) { Exit-Smoke; return }
    $before = Get-UserRetries $status
    # gpg-agent starts its pinentry with the agent's own environment: set the mode before the agent starts.
    Stop-Agents 'gpg-agent'
    $env:MULTIKEY_SMOKE_PIN_MODE = 'wrong'
    if (Invoke-CardEdit 'verify', 'quit') { Bad 'a wrong PIN was accepted' } else { Write-Host '(the wrong PIN was refused, as expected)' }
    Stop-Agents 'gpg-agent'
    $env:MULTIKEY_SMOKE_PIN_MODE = $oldMode
    $status = Get-CardStatus; if ($null -eq $status) { Exit-Smoke; return }
    $after = Get-UserRetries $status
    if ($after -eq $before - 1) { Pass "retry counter $before -> $after" } else { Bad "retry counter $before -> $after (expected one less)" }
    if (Invoke-CardEdit 'verify', 'quit') { Pass 'correct PIN accepted' } else { Bad 'correct PIN refused' }
    $status = Get-CardStatus; if ($null -eq $status) { Exit-Smoke; return }
    if ((Get-UserRetries $status) -eq $before) { Pass "retry counter restored to $before" } else { Bad "retry counter is $(Get-UserRetries $status), expected $before" }

    if (-not $NoReplug) {
        Write-Host '--- persistence'
        Read-Host 'REPLUG NOW: unplug the board and plug it back in, then press Enter' | Out-Null
        Stop-Agents 'scdaemon'
        Start-Sleep -Seconds 2
        $status = Get-CardStatus; if ($null -eq $status) { Exit-Smoke; return }
        $sig = Get-Field $status 'Signature key'
        if ($sig -and $sig -ne '[none]') { Pass 'keys survived the replug' } else { Bad 'keys are gone after the replug' }
        Invoke-Cycle 'after replug'
    } else { Skip 'replug persistence (-NoReplug)' }

    Write-Host 'Results are not hardware verified until recorded in docs/hw-reports/.'
    Exit-Smoke
}
finally {
    Stop-Agents
    $env:MULTIKEY_SMOKE_PIN_MODE = $oldMode
    $env:GNUPGHOME = $oldHome
    Remove-Item -LiteralPath $home_ -Recurse -Force -ErrorAction SilentlyContinue
}
