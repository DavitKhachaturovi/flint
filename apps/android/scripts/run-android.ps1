# Builds Flint for Android (development) and installs it on the phone connected by USB (D-165, docs/05 §8).
# Uses Android Studio's own Java and SDK for this build only; the PC's JAVA_HOME and PATH stay as they are.
# The JavaScript comes from the bundler (npm run start -w @flint/android), which must be running.
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$env:JAVA_HOME = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:Path = (Join-Path $env:ANDROID_HOME 'platform-tools') + ';' + (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path
if (-not (Test-Path (Join-Path $app 'android'))) {
  node (Join-Path $app '..\..\node_modules\expo\bin\cli') prebuild --platform android --no-install
}
$properties = Join-Path $app 'android\local.properties'
if (-not (Test-Path $properties)) {
  'sdk.dir=' + ($env:ANDROID_HOME -replace '\\', '/') | Set-Content -Encoding ascii $properties
}
Set-Location $app
node (Join-Path $app '..\..\node_modules\expo\bin\cli') run:android --no-bundler @args
