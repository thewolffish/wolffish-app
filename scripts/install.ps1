#Requires -Version 5.1
<#
.SYNOPSIS
    Wolffish installer for Windows.
.DESCRIPTION
    Downloads and installs the latest version of Wolffish from releases.wolffi.sh.
.PARAMETER Help
    Show help message.
.PARAMETER Version
    Print the latest available version and exit.
#>
param(
    [switch]$Help,
    [switch]$Version
)

$ErrorActionPreference = "Stop"
$ReleasesBase = "https://releases.wolffi.sh"

function Write-Banner {
    $cyan = [char]27 + "[36m"
    $bold = [char]27 + "[1m"
    $reset = [char]27 + "[0m"

    Write-Host ""
    Write-Host "${cyan}  +--+  +--+  +   +--+ +--+ + +--+ +  +" -NoNewline
    Write-Host "$reset"
    Write-Host "${cyan}  |  |  | /|  |   |    |    | |    |  |" -NoNewline
    Write-Host "$reset"
    Write-Host "${cyan}  +/\+  +/ |  +-- +--  +--  + +--+ +--+" -NoNewline
    Write-Host "$reset"
    Write-Host ""
    Write-Host "  ${bold}Wolffish Installer${reset}"
    Write-Host ""
}

function Write-Info { param([string]$Msg) Write-Host "[i] $Msg" -ForegroundColor Blue }
function Write-Ok { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Err { param([string]$Msg) Write-Host "[x] $Msg" -ForegroundColor Red }

function Show-Usage {
    Write-Banner
    Write-Host "Usage: install.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Help       Show this help message"
    Write-Host "  -Version    Print the latest available version and exit"
    Write-Host ""
    Write-Host "Downloads and installs the latest Wolffish for Windows."
    exit 0
}

function Get-Manifest {
    param([string]$Url)
    try {
        $response = Invoke-RestMethod -Uri $Url -UseBasicParsing
        return $response
    } catch {
        Write-Err "Failed to download manifest from $Url"
        Write-Err $_.Exception.Message
        exit 1
    }
}

function Get-ManifestVersion {
    param([string]$Manifest)
    $match = [regex]::Match($Manifest, '(?m)^version:\s*(.+)$')
    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return $null
}

function Get-ManifestUrl {
    param([string]$Manifest, [string]$Extension)
    $match = [regex]::Match($Manifest, "url:\s*(.+\.$Extension)")
    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return $null
}

function Get-ManifestSha512 {
    param([string]$Manifest, [string]$Filename)
    $lines = $Manifest -split "`n"
    $inEntry = $false
    foreach ($line in $lines) {
        if ($line -match "url:.*$([regex]::Escape($Filename))") {
            $inEntry = $true
        } elseif ($inEntry -and $line -match "sha512:\s*(.+)") {
            return $Matches[1].Trim()
        } elseif ($inEntry -and $line -match "^\s*-\s") {
            break
        }
    }
    return $null
}

function Test-Checksum {
    param([string]$FilePath, [string]$ExpectedBase64)

    Write-Info "Verifying checksum..."

    $hashObj = Get-FileHash -Path $FilePath -Algorithm SHA512
    $actualHex = $hashObj.Hash.ToLower()

    $expectedBytes = [Convert]::FromBase64String($ExpectedBase64)
    $expectedHex = -join ($expectedBytes | ForEach-Object { $_.ToString("x2") })

    if ($actualHex -ne $expectedHex) {
        Write-Err "Checksum mismatch!"
        Write-Err "  Expected: $expectedHex"
        Write-Err "  Got:      $actualHex"
        Write-Err "The downloaded file may be corrupted. Aborting."
        exit 1
    }

    Write-Ok "Checksum verified"
}

function Install-Wolffish {
    if ($Help) { Show-Usage }

    $manifest = Get-Manifest "$ReleasesBase/latest.yml"

    $version = Get-ManifestVersion $manifest
    if (-not $version) {
        Write-Err "Could not determine latest version from manifest"
        exit 1
    }

    if ($Version) {
        Write-Host $version
        exit 0
    }

    Write-Banner
    Write-Ok "Latest version: $version"

    $relUrl = Get-ManifestUrl $manifest "exe"
    if (-not $relUrl) {
        Write-Err "Could not find .exe download URL in manifest"
        exit 1
    }

    $filename = [System.IO.Path]::GetFileName($relUrl)
    $sha512Base64 = Get-ManifestSha512 $manifest $filename

    $downloadUrl = "$ReleasesBase/$relUrl"
    $tempDir = Join-Path $env:TEMP "wolffish-install"
    $destPath = Join-Path $tempDir $filename

    try {
        if (-not (Test-Path $tempDir)) {
            New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        }

        Write-Info "Downloading $downloadUrl ..."
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destPath -UseBasicParsing
        $ProgressPreference = 'Continue'
        Write-Ok "Download complete"

        if ($sha512Base64) {
            Test-Checksum $destPath $sha512Base64
        } else {
            Write-Warn "No checksum found in manifest - skipping verification"
        }

        Write-Info "Running installer..."
        $process = Start-Process -FilePath $destPath -ArgumentList "/S" -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            Write-Err "Installer exited with code $($process.ExitCode)"
            exit 1
        }

        Write-Ok "Wolffish v$version installed successfully!"
        Write-Host ""
    } catch {
        Write-Err "Installation failed: $($_.Exception.Message)"
        exit 1
    } finally {
        if (Test-Path $tempDir) {
            Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
        }
    }
}

Install-Wolffish
