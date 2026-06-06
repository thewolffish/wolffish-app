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

# Force TLS 1.2+ for every web call. Older Windows/.NET defaults to TLS 1.0,
# which Cloudflare/R2 reject — and this must run BEFORE the first request
# (the manifest fetch), or the install dies before it starts.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

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

# Minimal inline progress line, drawn at the bottom (where the cursor is).
# Best-effort only: callers MUST guard this so a drawing failure never
# affects the download.
function Show-DownloadProgress {
    param([int]$Percent, [long]$Done, [long]$Total)
    $doneMB = "{0:N1}" -f ($Done / 1MB)
    if ($Total -gt 0) {
        $width = 22
        $fill = [int]($width * $Percent / 100)
        if ($fill -lt 0) { $fill = 0 } elseif ($fill -gt $width) { $fill = $width }
        $bar = ('#' * $fill) + ('-' * ($width - $fill))
        $totalMB = "{0:N1}" -f ($Total / 1MB)
        $line = "  [$bar] {0,3}%  {1}/{2} MB" -f $Percent, $doneMB, $totalMB
    } else {
        $line = "  Downloading...  {0} MB" -f $doneMB
    }
    # PadRight clears any leftovers from a previous, longer line.
    Write-Host ("`r" + $line.PadRight(56)) -ForegroundColor Cyan -NoNewline
}

# Stream the download to disk in chunks, drawing our own progress line, and
# transparently RESUME via HTTP Range if the connection stalls or drops
# mid-transfer (the usual cause of a "hang" — what BITS used to handle for us).
# A read that delivers no data for 60s is treated as stalled; we reconnect and
# continue from the byte we reached instead of blocking or restarting at zero.
# Any unrecoverable failure bubbles up so the caller can fall back.
function Get-StreamedFile {
    param([string]$Url, [string]$Dest)

    $file = [System.IO.File]::Create($Dest)
    $buffer = New-Object byte[] 81920
    $downloaded = [int64]0
    $total = [int64](-1)
    $render = $true
    $rendered = $false
    $lastShown = -1
    $attempt = 0
    $maxAttempts = 5   # consecutive *no-progress* failures before giving up

    try {
        while ($true) {
            $resp = $null
            $stream = $null
            $before = $downloaded
            try {
                $req = [System.Net.HttpWebRequest]([System.Net.WebRequest]::Create($Url))
                $req.UserAgent = "Wolffish-Installer"
                $req.Timeout = 30000           # connect timeout
                $req.ReadWriteTimeout = 60000  # 60s with no data = stalled
                if ($downloaded -gt 0) { $req.AddRange($downloaded) }   # resume point

                $resp = $req.GetResponse()
                $http = [System.Net.HttpWebResponse]$resp

                # Resumed, but the server ignored Range and sent the whole file
                # (200, not 206): restart cleanly to avoid a corrupt file.
                if ($downloaded -gt 0 -and $http.StatusCode -ne [System.Net.HttpStatusCode]::PartialContent) {
                    $file.SetLength(0)
                    [void]$file.Seek(0, [System.IO.SeekOrigin]::Begin)
                    $downloaded = 0
                }

                # Capture full size from the first non-range response.
                if ($total -lt 0 -and $downloaded -eq 0) {
                    $total = [int64]$resp.ContentLength
                }

                $stream = $resp.GetResponseStream()
                while (($n = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $file.Write($buffer, 0, $n)
                    $downloaded += $n

                    # --- progress drawing is fully isolated from the transfer ---
                    if ($render) {
                        try {
                            if ($total -gt 0) {
                                $pct = [int](($downloaded * 100) / $total)
                                if ($pct -ne $lastShown) {
                                    $lastShown = $pct
                                    Show-DownloadProgress $pct $downloaded $total
                                    $rendered = $true
                                }
                            } else {
                                $mb = [int]($downloaded / 1MB)
                                if ($mb -ne $lastShown) {
                                    $lastShown = $mb
                                    Show-DownloadProgress -1 $downloaded -1
                                    $rendered = $true
                                }
                            }
                        } catch {
                            # Drawing failed (redirected output, no console).
                            # Stop trying; the download keeps going.
                            $render = $false
                        }
                    }
                }

                $stream.Close(); $stream = $null
                $resp.Close();   $resp = $null

                # Complete if we have it all (or length was unknown and the
                # stream ended cleanly).
                if ($total -lt 0 -or $downloaded -ge $total) { break }
                # Server closed early before EOF — loop to resume.
            } catch {
                if ($stream) { try { $stream.Close() } catch {} }
                if ($resp)   { try { $resp.Close() }   catch {} }

                # Reset the counter whenever we made forward progress, so a flaky
                # link that keeps inching ahead still finishes; only give up after
                # $maxAttempts consecutive failures that moved zero bytes.
                if ($downloaded -gt $before) { $attempt = 0 } else { $attempt++ }
                if ($attempt -ge $maxAttempts) { throw }
                Start-Sleep -Milliseconds (500 * $attempt)
            }
        }
    } finally {
        $file.Close()
        if ($rendered) { try { Write-Host "" } catch {} }  # end the progress line
    }
}

function Save-RemoteFile {
    param([string]$Url, [string]$Dest)

    try {
        # Primary: resumable streamed download with our own bottom progress bar.
        Get-StreamedFile $Url $Dest
    } catch {
        # Last resort if the streamed path errors for a real network/IO reason
        # (display errors can't reach here — they're swallowed inside the loop).
        # A plain WebClient is a separate, dependable code path, and
        # HttpWebRequest's default 5-min ReadWriteTimeout stops it hanging
        # forever. It overwrites any partial file from the failed attempt.
        $client = New-Object System.Net.WebClient
        try {
            $client.Headers.Add("User-Agent", "Wolffish-Installer")
            $client.DownloadFile($Url, $Dest)
        } finally {
            $client.Dispose()
        }
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
