# MultiKeys host tool installer for Windows x64 (Windows PowerShell 5.1 or PowerShell 7).
#
#   irm https://get.mewis.me/esp32-security-key.ps1 | iex
#   & ([scriptblock]::Create((irm https://get.mewis.me/esp32-security-key.ps1))) --version v0.2.0
#   & ([scriptblock]::Create((irm https://get.mewis.me/esp32-security-key.ps1))) --uninstall
#
# Options (-Name and --name both work):
#   --version VERSION   install this release (v0.2.0 or 0.2.0) instead of the latest
#   --no-modify-path    do not add the install directory to your user PATH
#   --uninstall         remove multikey and the PATH entry this installer added
#
# Environment:
#   MULTIKEY_VERSION          same as --version
#   MULTIKEY_INSTALL_DIR      directory for multikey.exe (default %LOCALAPPDATA%\Programs\MultiKeys\bin)
#   MULTIKEY_SHARE_DIR        directory for LICENSE and THIRD_PARTY_LICENSES.txt
#                             (default %LOCALAPPDATA%\Programs\MultiKeys\share)
#   MULTIKEY_NO_MODIFY_PATH   any value: same as --no-modify-path
#   MULTIKEY_BASE_URL         release download base (default
#                             https://github.com/mewisme/esp32-security-key/releases/download)
#
# The release is checked against its SHA256SUMS before anything is installed. The installer does not touch the key.
# Everything runs inside one script block, so nothing is left behind in your session except the PATH entry.

& {
    param([string[]] $Options = @())

    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    $Repo = 'mewisme/esp32-security-key'
    $Binary = 'multikey'

    function Stop-Installer([string] $Message) {
        throw "MultiKeys installer: $Message"
    }

    $Uninstall = $false
    $NoModifyPath = -not [string]::IsNullOrEmpty($env:MULTIKEY_NO_MODIFY_PATH)
    $Version = $env:MULTIKEY_VERSION
    for ($i = 0; $i -lt $Options.Count; $i++) {
        switch -Regex ($Options[$i]) {
            '^--?uninstall$' { $Uninstall = $true }
            '^--?no-?modify-?path$' { $NoModifyPath = $true }
            '^--?version$' {
                $i++
                if ($i -ge $Options.Count) { Stop-Installer 'the version option needs a value' }
                $Version = $Options[$i]
            }
            default { Stop-Installer "unknown option: $($Options[$i])" }
        }
    }

    $IsWindowsPlatform = $env:OS -eq 'Windows_NT'
    if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
        $IsWindowsPlatform = $IsWindows
    }
    if (-not $IsWindowsPlatform) {
        Stop-Installer 'install.ps1 supports Windows only; on Linux use install.sh'
    }

    $AppDir = Join-Path $env:LOCALAPPDATA 'Programs\MultiKeys'
    $InstallDir = if ($env:MULTIKEY_INSTALL_DIR) { $env:MULTIKEY_INSTALL_DIR } else { Join-Path $AppDir 'bin' }
    $ShareDir = if ($env:MULTIKEY_SHARE_DIR) { $env:MULTIKEY_SHARE_DIR } else { Join-Path $AppDir 'share' }
    $BinaryPath = Join-Path $InstallDir "$Binary.exe"
    $PathMarker = Join-Path $InstallDir '.multikey-path-managed'
    $Notices = @('LICENSE', 'THIRD_PARTY_LICENSES.txt')

    if ($Uninstall) {
        $HadBinary = Test-Path -LiteralPath $BinaryPath
        $HadMarker = Test-Path -LiteralPath $PathMarker
        if (-not $HadBinary -and -not $HadMarker) {
            Write-Host "MultiKeys is not installed in $InstallDir"
            return
        }
        if ($HadBinary) {
            Remove-Item -Force -LiteralPath $BinaryPath
        }
        if ($HadMarker) {
            $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $Kept = @($UserPath -split ';' | Where-Object { $_ -and $_ -ne $InstallDir })
            [Environment]::SetEnvironmentVariable('Path', ($Kept -join ';'), 'User')
            $env:Path = (($env:Path -split ';' | Where-Object { $_ -and $_ -ne $InstallDir }) -join ';')
            Remove-Item -Force -LiteralPath $PathMarker
        }
        foreach ($Notice in $Notices) {
            Remove-Item -Force -LiteralPath (Join-Path $ShareDir $Notice) -ErrorAction SilentlyContinue
        }
        foreach ($Dir in @($InstallDir, $ShareDir, $AppDir)) {
            if ((Test-Path -LiteralPath $Dir) -and -not (Get-ChildItem -Force -LiteralPath $Dir | Select-Object -First 1)) {
                Remove-Item -Force -LiteralPath $Dir
            }
        }
        Write-Host "Uninstalled MultiKeys from $InstallDir"
        $TrustStore = Join-Path $env:ProgramData 'MultiKeys\trusted.toml'
        if (Test-Path -LiteralPath $TrustStore) {
            Write-Host "Left $TrustStore (the enrolled login keys) in place; delete it yourself if you do not need it."
        }
        return
    }

    if ($PSVersionTable.PSVersion.Major -lt 6) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }

    $Architecture = try {
        [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    } catch {
        [string] $env:PROCESSOR_ARCHITECTURE
    }
    if ($Architecture -notin @('X64', 'AMD64')) {
        Stop-Installer "unsupported architecture: $Architecture (releases carry x86_64 builds only; to build from source run: cd host; cargo build --release)"
    }

    $UserAgent = 'multikey-installer'
    if ($Version) {
        $Tag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
    } else {
        try {
            $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UserAgent $UserAgent
        } catch {
            Stop-Installer "could not look up the latest release ($($_.Exception.Message)); set MULTIKEY_VERSION (for example v0.2.0) to skip the lookup"
        }
        $Tag = [string] $Release.tag_name
    }
    # The tag becomes part of URLs and file names.
    if ($Tag -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$') {
        Stop-Installer "invalid release tag: $Tag (expected for example v0.2.0)"
    }

    $BaseUrl = if ($env:MULTIKEY_BASE_URL) { $env:MULTIKEY_BASE_URL.TrimEnd('/') } else { "https://github.com/$Repo/releases/download" }
    $Asset = "multikey-$Tag-windows-x86_64.zip"
    $TempDir = Join-Path ([IO.Path]::GetTempPath()) ('multikey-' + [guid]::NewGuid().ToString('N'))

    function Get-ReleaseFile([string] $Name) {
        $Url = "$BaseUrl/$Tag/$Name"
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -UserAgent $UserAgent -OutFile (Join-Path $TempDir $Name)
        } catch {
            Stop-Installer "download failed: $Url ($($_.Exception.Message))"
        }
    }

    try {
        New-Item -ItemType Directory -Path $TempDir | Out-Null
        Write-Host "Installing MultiKeys $Tag (windows/x86_64)"
        Get-ReleaseFile 'SHA256SUMS'
        Get-ReleaseFile $Asset

        $Expected = $null
        foreach ($Line in Get-Content -LiteralPath (Join-Path $TempDir 'SHA256SUMS')) {
            $Parts = $Line -split '\s+', 2
            if ($Parts.Count -eq 2 -and $Parts[1].TrimStart('*') -eq $Asset) {
                $Expected = $Parts[0].ToLowerInvariant()
                break
            }
        }
        if (-not $Expected) {
            Stop-Installer "SHA256SUMS has no entry for $Asset"
        }
        $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $TempDir $Asset)).Hash.ToLowerInvariant()
        if ($Actual -ne $Expected) {
            Stop-Installer "checksum verification failed for $Asset"
        }

        Expand-Archive -LiteralPath (Join-Path $TempDir $Asset) -DestinationPath $TempDir -Force
        $Root = Join-Path $TempDir ([IO.Path]::GetFileNameWithoutExtension($Asset))
        if (-not (Test-Path -LiteralPath (Join-Path $Root "$Binary.exe"))) {
            Stop-Installer "unexpected archive layout: $Binary.exe is missing"
        }

        New-Item -ItemType Directory -Force -Path $InstallDir, $ShareDir | Out-Null
        try {
            Copy-Item -Force -LiteralPath (Join-Path $Root "$Binary.exe") -Destination $BinaryPath
        } catch {
            Stop-Installer "could not write $BinaryPath ($($_.Exception.Message)); close programs that use multikey.exe and run the installer again"
        }
        foreach ($Notice in $Notices) {
            Copy-Item -Force -LiteralPath (Join-Path $Root $Notice) -Destination (Join-Path $ShareDir $Notice)
        }

        $VersionLine = & $BinaryPath --version
        if ($LASTEXITCODE -ne 0) {
            Stop-Installer "$BinaryPath was installed but does not run (exit code $LASTEXITCODE)"
        }

        $PathChanged = $false
        if (-not $NoModifyPath) {
            $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $Entries = @($UserPath -split ';' | Where-Object { $_ })
            if ($Entries -notcontains $InstallDir) {
                $NewUserPath = if ([string]::IsNullOrWhiteSpace($UserPath)) { $InstallDir } else { "$UserPath;$InstallDir" }
                [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
                New-Item -ItemType File -Force -Path $PathMarker | Out-Null
                $PathChanged = $true
            }
            if (($env:Path -split ';') -notcontains $InstallDir) {
                $env:Path = "$InstallDir;$env:Path"
            }
        }

        Write-Host "Installed $VersionLine to $BinaryPath"
        if ($PathChanged) {
            Write-Host "Added $InstallDir to your user PATH; terminals opened from now on find multikey."
        }
        Write-Host 'FIDO commands only see the key from an Administrator terminal.'
    } finally {
        if (Test-Path -LiteralPath $TempDir) {
            Remove-Item -Recurse -Force -LiteralPath $TempDir
        }
    }
} $args
