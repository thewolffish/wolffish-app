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
    Write-Host ""
    Write-Host '  #   # ##### #     ##### ##### ##### ##### #   #' -ForegroundColor Cyan
    Write-Host '  #   # #   # #     #     #       #   #     #   #' -ForegroundColor Cyan
    Write-Host '  # # # #   # #     ####  ####    #   ##### #####' -ForegroundColor Cyan
    Write-Host '  ## ## #   # #     #     #       #       # #   #' -ForegroundColor Cyan
    Write-Host '  #   # ##### ##### #     #     ##### ##### #   #' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Wolffish Installer" -ForegroundColor White
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
}

function Get-Manifest {
    param([string]$Url)
    try {
        $response = Invoke-RestMethod -Uri $Url -UseBasicParsing
        return $response
    } catch {
        throw "Failed to download manifest from ${Url}: $($_.Exception.Message)"
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
        throw "Checksum mismatch!`n  Expected: $expectedHex`n  Got:      $actualHex`nThe downloaded file may be corrupted."
    }

    Write-Ok "Checksum verified"
}

function Save-RemoteFile {
    param([string]$Url, [string]$Dest)

    # Ensure a modern TLS version (PS 5.1 / older .NET can default to TLS 1.0)
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {}

    # Prefer BITS: fast, resumable, and shows a real progress bar.
    # Invoke-WebRequest -OutFile is very slow for large binaries on PS 5.1
    # and appears to hang when the progress bar is suppressed.
    $bits = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
    if ($bits) {
        try {
            Start-BitsTransfer -Source $Url -Destination $Dest -Description "Downloading Wolffish" -ErrorAction Stop
            return
        } catch {
            Write-Warn "BITS transfer unavailable, using direct download..."
        }
    }

    # Fallback: WebClient streams straight to disk (fast, low memory, no hang)
    $client = New-Object System.Net.WebClient
    try {
        $client.Headers.Add("User-Agent", "Wolffish-Installer")
        $client.DownloadFile($Url, $Dest)
    } finally {
        $client.Dispose()
    }
}

function Install-Wolffish {
    if ($Help) { Show-Usage; return }

    $manifest = Get-Manifest "$ReleasesBase/latest.yml"

    $latestVersion = Get-ManifestVersion $manifest
    if (-not $latestVersion) {
        throw "Could not determine latest version from manifest"
    }

    if ($Version) {
        Write-Host $latestVersion
        return
    }

    Write-Banner
    Write-Ok "Latest version: $latestVersion"

    $relUrl = Get-ManifestUrl $manifest "exe"
    if (-not $relUrl) {
        throw "Could not find .exe download URL in manifest"
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
        Save-RemoteFile $downloadUrl $destPath
        Write-Ok "Download complete"

        if ($sha512Base64) {
            Test-Checksum $destPath $sha512Base64
        } else {
            Write-Warn "No checksum found in manifest - skipping verification"
        }

        Write-Info "Running installer..."
        $process = Start-Process -FilePath $destPath -ArgumentList "/S" -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Installer exited with code $($process.ExitCode)"
        }

        Write-Ok "Wolffish v$latestVersion installed successfully!"
        Write-Host ""
    } finally {
        if (Test-Path $tempDir) {
            Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
        }
    }
}

try {
    Install-Wolffish
} catch {
    Write-Err $_.Exception.Message
}

Write-Host ""
Read-Host "Press Enter to exit"
