param([string]$Installer, [switch]$DisposableMachine)
$ErrorActionPreference = 'Stop'
if (-not $DisposableMachine -and -not ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_OS -eq 'Windows')) {
  throw 'Run only on a disposable Windows VM with -DisposableMachine, or a GitHub-hosted Windows runner.'
}
if (-not $Installer) {
  $version = (Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version
  $Installer = Join-Path $PSScriptRoot "../release/Iliad MD-$version-win-x64.exe"
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\Iliad MD'
$profileDirectory = Join-Path $env:APPDATA 'Iliad MD'
$commandPath = Join-Path $env:LOCALAPPDATA 'Iliad\bin\iliad.cmd'
if ((Test-Path $installDirectory) -or (Test-Path $profileDirectory) -or (Test-Path $commandPath) -or (Test-Path 'HKCU:\Software\Iliad MD')) {
  throw 'Existing Iliad state detected. Refusing to test against a personal installation.'
}
$pathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
function Install-App([string]$Choice = '') {
  $arguments = @('/S')
  if ($Choice) { $arguments += "/ILIADCLI=$Choice" }
  $process = Start-Process -FilePath $Installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    Write-Output "Installer diagnostics: app exists=$(Test-Path (Join-Path $installDirectory 'Iliad MD.exe')); CLI exists=$(Test-Path $commandPath)"
    Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Select-Object -First 3 -ExpandProperty Message | Write-Output
    throw "Installer failed: $($process.ExitCode)"
  }
}
Install-App
if (Test-Path $commandPath) { throw 'CLI must be opt-in on a fresh installation.' }
Write-Output 'PASS fresh installation does not install CLI'
New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
$preferences = Join-Path $profileDirectory 'Preferences'
Set-Content -LiteralPath $preferences -Value '{"windows-test":"preserve"}'
$preferencesHash = (Get-FileHash -LiteralPath $preferences).Hash
Install-App '1'
if (-not (Test-Path $commandPath)) { throw 'Explicit CLI installation failed.' }
Install-App
if (-not (Test-Path $commandPath)) { throw 'Reinstall lost CLI selection.' }
if ((Get-FileHash -LiteralPath $preferences).Hash -ne $preferencesHash) { throw 'Preferences changed.' }
Write-Output 'PASS opt-in and reinstall preserve CLI and preferences'
& node (Join-Path $PSScriptRoot 'smokeWindows.mjs') (Join-Path $installDirectory 'Iliad MD.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke test failed.' }
Install-App '0'
if (Test-Path $commandPath) { throw 'Explicit opt-out left the managed command.' }
Install-App
if (Test-Path $commandPath) { throw 'Reinstall lost opt-out selection.' }
Install-App '1'
$process = Start-Process -FilePath (Join-Path $installDirectory 'Uninstall Iliad MD.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw 'Uninstaller failed.' }
$deadline = (Get-Date).AddSeconds(30)
while ((Test-Path (Join-Path $installDirectory 'Iliad MD.exe')) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
if (Test-Path (Join-Path $installDirectory 'Iliad MD.exe')) { throw 'Application executable remains.' }
if (Test-Path $commandPath) { throw 'Managed CLI remains.' }
if ((Get-FileHash -LiteralPath $preferences).Hash -ne $preferencesHash) { throw 'Uninstall changed preferences.' }
if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $pathBefore) { throw 'Unrelated PATH content changed.' }
Write-Output 'PASS uninstall preserves preferences and unrelated PATH'
