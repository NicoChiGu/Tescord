$ErrorActionPreference = "Stop"

$binDir = Join-Path $PSScriptRoot "..\bin"
$exePath = Join-Path $binDir "livekit-server.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "[Tescord] livekit-server.exe not found. Downloading..." -ForegroundColor Cyan
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    }

    $zipUrl = "https://github.com/livekit/livekit/releases/download/v1.13.7/livekit_1.13.7_windows_amd64.zip"
    $zipPath = Join-Path $binDir "livekit.zip"

    Write-Host "[Tescord] Downloading LiveKit SFU (v1.13.7) from GitHub..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

    Write-Host "[Tescord] Extracting to $binDir..." -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $binDir -Force
    Remove-Item $zipPath -Force

    Write-Host "[Tescord] LiveKit SFU ready." -ForegroundColor Green
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Starting LiveKit SFU media server in dev mode (:7880)..." -ForegroundColor Green
Write-Host " Key: devkey | Secret: secretsecretsecret" -ForegroundColor Gray
Write-Host " Signaling: ws://localhost:7880 | WebRTC UDP: 50000-50100" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green

& $exePath --dev
