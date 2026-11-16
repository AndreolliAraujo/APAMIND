$ErrorActionPreference = "Stop"

$worktree = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$env:GIT_CONFIG_COUNT = "1"
$env:GIT_CONFIG_KEY_0 = "safe.directory"
$env:GIT_CONFIG_VALUE_0 = $worktree
$expectedBranch = "main"
$branch = (& git -C $worktree branch --show-current).Trim()
if ($branch -ne $expectedBranch) {
  throw "Este script só pode compilar na branch $expectedBranch (branch atual: $branch)."
}

$outputDir = Join-Path $env:TEMP "ApaMind-Homologacao-0.7.1"
$scratchDir = Join-Path $outputDir "scratch"
$installerPath = Join-Path $outputDir "ApaMind-Homologacao-0.7.1-x64-setup.exe"
if (Test-Path -LiteralPath $installerPath) {
  throw "O instalador já existe; mova-o manualmente antes de recompilar: $installerPath"
}
if (Test-Path -LiteralPath $scratchDir) {
  throw "A pasta temporária da compilação já existe: $scratchDir"
}
New-Item -ItemType Directory -Path $scratchDir | Out-Null

$env:APAMIND_HOMOLOGACAO = "1"
$env:VITE_APAMIND_HOMOLOGACAO = "1"
$env:CARGO_NET_OFFLINE = "true"
$env:TEMP = $scratchDir
$env:TMP = $scratchDir

$tauriCli = Join-Path $worktree "node_modules/@tauri-apps/cli/tauri.js"
if (-not (Test-Path -LiteralPath $tauriCli)) {
  throw "CLI Tauri indisponível no node_modules: $tauriCli"
}
Push-Location $worktree
try {
  & node $tauriCli build --config src-tauri/tauri.homologacao.conf.json --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw "Tauri build terminou com código $LASTEXITCODE." }
} finally {
  Pop-Location
}

$bundleDir = Join-Path $worktree "src-tauri/target/release/bundle/nsis"
$builtInstallers = @(Get-ChildItem -LiteralPath $bundleDir -File -Filter "*_0.7.1_x64-setup.exe")
if ($builtInstallers.Count -ne 1) {
  throw "Esperado exatamente um instalador NSIS x64 0.7.1 em $bundleDir; encontrados $($builtInstallers.Count)."
}
Copy-Item -LiteralPath $builtInstallers[0].FullName -Destination $installerPath
Write-Output "Instalador criado: $installerPath"
