<#
.SYNOPSIS
  Download every Halo Infinite CSR rank badge into public\images\ for the
  packaged app, so the badges are served locally (no ERR_BLOCKED_BY_ORB).

.DESCRIPTION
  Windows-native (PowerShell 5.1+ or PowerShell 7+). No Node.js required.

  The files keep their leafapp.co names so the app finds them unchanged:
    onyx.png
    {bronze,silver,gold,platinum,diamond}-{1..6}.png

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\download-badges.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\download-badges.ps1 -Force
#>
[CmdletBinding()]
param(
  [string]$Out = (Join-Path $PSScriptRoot '..\public\images'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$sourceBase = 'https://leafapp.co/images/csrs/'
$tiers = @('bronze', 'silver', 'gold', 'platinum', 'diamond')
$subTiers = 1..6

$files = @('onyx.png')
foreach ($tier in $tiers) {
  foreach ($n in $subTiers) {
    $files += "$tier-$n.png"
  }
}

$outPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Out))
if (-not (Test-Path $outPath)) {
  New-Item -ItemType Directory -Path $outPath -Force | Out-Null
}

Write-Host "Downloading $($files.Count) badges from $sourceBase"
Write-Host "Into: $outPath`n"

$headers = @{
  'User-Agent'      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  'Accept'          = 'image/avif,image/webp,image/png,image/*,*/*;q=0.8'
  'Accept-Language' = 'en-US,en;q=0.9'
  'Referer'         = 'https://leafapp.co/'
}

$pngMagic = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
$saved = 0
$skipped = 0
$failed = @()

foreach ($file in $files) {
  $dest = Join-Path $outPath $file
  if ((Test-Path $dest) -and -not $Force) {
    Write-Host "  skipped $file (already exists, use -Force)"
    $skipped++
    continue
  }

  try {
    $response = Invoke-WebRequest -Uri ($sourceBase + $file) -Headers $headers -UseBasicParsing
    $bytes = [byte[]]$response.Content

    $isPng = $bytes.Length -ge 8
    if ($isPng) {
      for ($i = 0; $i -lt 8; $i++) {
        if ($bytes[$i] -ne $pngMagic[$i]) { $isPng = $false; break }
      }
    }

    if (-not $isPng) {
      $type = $response.Headers['Content-Type']
      $reason = "not a PNG ($type) - the host likely returned a bot/HTML challenge"
      Write-Host "  FAILED  $file`: $reason"
      $failed += "$file ($reason)"
      continue
    }

    [System.IO.File]::WriteAllBytes($dest, $bytes)
    Write-Host "  saved   $file ($($bytes.Length) bytes)"
    $saved++
  }
  catch {
    Write-Host "  FAILED  $file`: $($_.Exception.Message)"
    $failed += "$file ($($_.Exception.Message))"
  }
}

Write-Host "`nDone. saved=$saved skipped=$skipped failed=$($failed.Count)"
if ($failed.Count -gt 0) {
  Write-Host "`nSome files did not download as real PNGs. leafapp.co protects its assets"
  Write-Host "with a bot challenge, so a script may receive HTML instead. If that happens,"
  Write-Host "download the images in a browser and drop them into the images folder by hand,"
  Write-Host "keeping the exact filenames listed above."
  exit 1
}
