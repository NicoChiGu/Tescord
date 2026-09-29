param(
  [ValidateSet('baseline', 'release')][string]$Phase = 'baseline',
  [ValidateRange(1, 10)][int]$Runs = 1,
  [switch]$ForceRelay,
  [switch]$NetworkRecovery,
  [switch]$DMCall
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = 'tera@100.69.12.101'
$baseUrl = 'https://tescord.terata.top'
$resultRoot = Join-Path $repoRoot ('release/cloudflare-acceptance/' + $Phase + $(if ($DMCall) { '-dm-call' } elseif ($ForceRelay) { '-relay' } else { '-auto' }))
New-Item -ItemType Directory -Force -Path $resultRoot | Out-Null

for ($run = 1; $run -le $Runs; $run++) {
  $marker = [Guid]::NewGuid().ToString('N').Substring(0, 10)
  $username = 'AcceptanceAdmin_' + $marker
  $email = 'admin-' + $marker + '@example.invalid'
  $password = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $manifestPath = Join-Path $repoRoot 'test-results/cloudflare-target/resources.json'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
  Remove-Item -LiteralPath $manifestPath -ErrorAction SilentlyContinue
  $runDir = Join-Path $resultRoot ('run-' + $run + '-' + $marker)
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $fallbackManifestPath = Join-Path $runDir 'resources-initial.json'
  $manifest = $null
  $testExit = 1
  $cleanupExit = 1
  try {
    $creationOutput = $password | ssh -o BatchMode=yes $target "podman exec -i docker_server_1 pnpm --filter @tescord/server exec tsx scripts/create-admin.ts $username $email"
    if ($LASTEXITCODE -ne 0) { throw 'Exact acceptance admin creation failed' }
    $adminIdLine = $creationOutput | Where-Object { $_ -match '^ACCEPTANCE_ADMIN_ID=([A-Za-z0-9_-]+)$' } | Select-Object -Last 1
    if ($adminIdLine -match '^ACCEPTANCE_ADMIN_ID=([A-Za-z0-9_-]+)$') {
      $manifest = @{ marker = $marker; adminUserId = $Matches[1] }
      $manifest | ConvertTo-Json | Set-Content -LiteralPath $fallbackManifestPath -Encoding utf8
    }

    $login = Invoke-RestMethod -Method Post -Uri ($baseUrl + '/api/auth/login') -ContentType 'application/json' -Body (@{ emailOrUsername = $username; password = $password } | ConvertTo-Json -Compress)
    $manifest = @{ marker = $marker; adminUserId = $login.user.id }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $fallbackManifestPath -Encoding utf8
    $env:TESCORD_TARGET_BASE_URL = $baseUrl
    $env:TESCORD_ACCEPTANCE_ADMIN_USERNAME = $username
    $env:TESCORD_ACCEPTANCE_ADMIN_PASSWORD = $password
    $env:TESCORD_ACCEPTANCE_MARKER = $marker
    $env:TESCORD_MEASURE_VIDEO_LATENCY = '1'
    $env:TESCORD_FORCE_RELAY = $(if ($ForceRelay) { '1' } else { '0' })
    $env:TESCORD_TEST_NETWORK_RECOVERY = $(if ($NetworkRecovery) { '1' } else { '0' })
    Push-Location $repoRoot
    try {
      $spec = $(if ($DMCall) { 'e2e-real/cloudflare-dm-call.spec.ts' } else { 'e2e-real/cloudflare-live-media.spec.ts' })
      pnpm exec playwright test --config playwright.cloudflare-target.config.ts $spec
      $testExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
  } catch {
    Write-Error ('Acceptance run failed before completion: ' + $_.Exception.Message) -ErrorAction Continue
  } finally {
    $cleanupManifestPath = $(if (Test-Path -LiteralPath $manifestPath) { $manifestPath } else { $fallbackManifestPath })
    if (Test-Path -LiteralPath $cleanupManifestPath) {
      $manifestJson = Get-Content -LiteralPath $cleanupManifestPath -Raw
      $manifestJson | ssh -o BatchMode=yes $target 'podman exec -i docker_server_1 pnpm --filter @tescord/server exec tsx scripts/cleanup-acceptance.ts'
      $cleanupExit = $LASTEXITCODE
      Copy-Item -LiteralPath $cleanupManifestPath -Destination (Join-Path $runDir 'resources.json') -Force
    }
    $statsName = $(if ($DMCall) { 'dm-media-stats.json' } else { 'media-stats.json' })
    $statsPath = Join-Path $repoRoot ('test-results/cloudflare-target/' + $statsName)
    if (Test-Path -LiteralPath $statsPath) { Copy-Item -LiteralPath $statsPath -Destination (Join-Path $runDir $statsName) -Force }
    $screenshotName = $(if ($DMCall) { 'dm-call.png' } else { 'media-receiver.png' })
    $screenshotPath = Join-Path $repoRoot ('test-results/cloudflare-target/' + $screenshotName)
    if (Test-Path -LiteralPath $screenshotPath) { Copy-Item -LiteralPath $screenshotPath -Destination (Join-Path $runDir $screenshotName) -Force }
    @{ marker = $marker; phase = $Phase; run = $run; dmCall = [bool]$DMCall; forceRelay = [bool]$ForceRelay; networkRecovery = [bool]$NetworkRecovery; testExit = $testExit; cleanupExit = $cleanupExit } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'result.json') -Encoding utf8
    Remove-Item Env:TESCORD_ACCEPTANCE_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:TESCORD_ACCEPTANCE_ADMIN_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:TESCORD_ACCEPTANCE_MARKER -ErrorAction SilentlyContinue
    $password = $null
    if ($cleanupExit -ne 0) { throw "Cleanup failed for exact marker $marker; see $runDir" }
  }
  if ($testExit -ne 0) { throw "Acceptance failed for marker $marker; see $runDir" }
}
