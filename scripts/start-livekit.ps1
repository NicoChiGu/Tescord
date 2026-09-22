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

$existing = Get-Process livekit-server -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[Tescord] Found existing livekit-server process (PID: $($existing.Id)). Terminating old instance..." -ForegroundColor Yellow
    Stop-Process -Id $existing.Id -Force
    Start-Sleep -Seconds 1
}

$configPath = Join-Path $PSScriptRoot "..\docker\livekit.yaml"
$hasConfig = Test-Path $configPath

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Starting LiveKit SFU media server in dev mode (:7880)..." -ForegroundColor Green
Write-Host " Key: devkey | Secret: secretsecretsecret" -ForegroundColor Gray
Write-Host " Signaling: ws://localhost:7880 | WebRTC UDP: 50000-50100" -ForegroundColor Gray
if ($hasConfig) {
    $resolvedConfig = (Resolve-Path $configPath).Path
    Write-Host " Config: $resolvedConfig" -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Green
    & $exePath --dev --config $resolvedConfig
} else {
    Write-Host " Config: Explicit Keys Fallback" -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Green
    & $exePath --dev --keys "devkey: secretsecretsecret"
}
