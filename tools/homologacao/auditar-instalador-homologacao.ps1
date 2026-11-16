param(
  [string] $InstallerPath = (Join-Path $env:LOCALAPPDATA 'Temp/ApaMind-Homologacao-0.7.1-label-main/close-acl/ApaMind-Homologacao-0.7.1-close-acl-x64-setup.exe'),
  [string] $ExecutablePath = '',
  [string] $CapabilitiesManifestPath = '',
  [string] $BaseTauriConfigPath = (Join-Path $PSScriptRoot '../../src-tauri/tauri.conf.json'),
  [string] $HomologationTauriConfigPath = (Join-Path $PSScriptRoot '../../src-tauri/tauri.homologacao.conf.json'),
  [string] $BuildScriptPath = (Join-Path $PSScriptRoot 'build-homologacao.ps1'),
  [string] $SevenZipPath = ''
)

$ErrorActionPreference = 'Stop'

function Get-Sha256([string] $Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Merge-JsonObject($Base, $Overlay) {
  $merged = [ordered]@{}
  foreach ($property in $Base.PSObject.Properties) { $merged[$property.Name] = $property.Value }
  foreach ($property in $Overlay.PSObject.Properties) {
    $existing = $Base.PSObject.Properties[$property.Name]
    if ($existing -and $existing.Value -is [pscustomobject] -and $property.Value -is [pscustomobject]) {
      $merged[$property.Name] = Merge-JsonObject $existing.Value $property.Value
    } else {
      $merged[$property.Name] = $property.Value
    }
  }
  return [pscustomobject]$merged
}

function Get-EffectiveConfig {
  $base = Get-Content -LiteralPath $BaseTauriConfigPath -Raw | ConvertFrom-Json
  $overlay = Get-Content -LiteralPath $HomologationTauriConfigPath -Raw | ConvertFrom-Json
  Merge-JsonObject $base $overlay
}

function Find-SevenZip {
  if ($SevenZipPath) {
    if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) { throw "7-Zip não encontrado: $SevenZipPath" }
    return (Resolve-Path -LiteralPath $SevenZipPath).Path
  }
  $command = Get-Command 7z.exe, 7z, 7za.exe, 7za -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  throw '7-Zip não está disponível. O instalador não será executado; sem um extrator NSIS já instalado, não é possível ler o executável empacotado.'
}

function Get-EmbeddedExecutable([string] $ArchiveTool, [string] $ArchivePath) {
  $list = & $ArchiveTool l -slt -- $ArchivePath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "7-Zip não conseguiu listar o conteúdo NSIS: $($list -join ' ')" }
  $paths = @(
    $list | ForEach-Object {
      if ($_ -match '^Path = (.+)$') { $Matches[1] }
    } | Where-Object { [IO.Path]::GetFileName($_) -ieq 'apamind-homologacao.exe' }
  )
  if ($paths.Count -ne 1) { throw "Esperava um apamind-homologacao.exe no instalador; encontrados: $($paths.Count). Caminhos: $($paths -join ', ')" }

  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $ArchiveTool
  $quotedInstaller = '"' + $ArchivePath.Replace('"', '\"') + '"'
  $quotedMember = '"' + $paths[0].Replace('"', '\"') + '"'
  $start.Arguments = "x -so -y $quotedInstaller $quotedMember"
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'Não foi possível iniciar 7-Zip para extração em fluxo.' }
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
  $buffer = [byte[]]::new(65536)
  $length = [int64]0
  try {
    while (($read = $process.StandardOutput.BaseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $hash.AppendData($buffer, 0, $read)
      $length += $read
    }
    $process.WaitForExit()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Falha ao extrair o membro para fluxo (código $($process.ExitCode)): $stderr" }
    if ($length -eq 0) { throw 'O membro extraído está vazio.' }
    $digest = [BitConverter]::ToString($hash.GetHashAndReset()).Replace('-', '')
    return [pscustomobject]@{ MemberPath = $paths[0]; Length = $length; Sha256 = $digest }
  } finally {
    $hash.Dispose()
    $process.Dispose()
  }
}

function Get-ConfigEvidence($Config) {
  $app = $Config.app
  $windowLabels = @($app.windows | ForEach-Object { $_.label })
  $caps = @($app.security.capabilities | Where-Object { $_ -is [pscustomobject] })
  $closeCapability = $caps | Where-Object { $_.identifier -eq 'homologacao-window-close' } | Select-Object -First 1
  [pscustomobject]@{
    Identifier = $Config.identifier
    ProductName = $Config.productName
    Version = $Config.version
    WithGlobalTauri = [bool]$app.withGlobalTauri
    WindowLabels = $windowLabels
    InlineCloseCapabilityPresent = [bool]$closeCapability
    InlineCloseCapabilityWindows = if ($closeCapability) { @($closeCapability.windows) } else { @() }
    InlineCloseCapabilityPermissions = if ($closeCapability) { @($closeCapability.permissions) } else { @() }
    ConfiguredCapabilityReferences = @($app.security.capabilities | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.identifier } })
  }
}

$report = [ordered]@{
  AuditVersion = 1
  GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
  Installer = [ordered]@{ Path = $InstallerPath; Exists = $false; Sha256 = $null; Length = $null; ProductName = $null; ProductVersion = $null }
  ExecutableSource = [ordered]@{ Path = $ExecutablePath; Exists = $false; Sha256 = $null; Length = $null }
  EmbeddedExecutable = [ordered]@{ Verified = $false; MemberPath = $null; Sha256 = $null; Length = $null; MatchesSourceExecutable = $false }
  BuildInputs = [ordered]@{ BaseConfigPath = $BaseTauriConfigPath; BaseConfigSha256 = $null; HomologationConfigPath = $HomologationTauriConfigPath; HomologationConfigSha256 = $null; BuildScriptPath = $BuildScriptPath; BuildScriptSha256 = $null; BuildScriptSelectsHomologationConfig = $false; EffectiveConfig = $null; CapabilitiesManifestPath = $CapabilitiesManifestPath; CapabilitiesManifestSha256 = $null; CompiledCapability = $null }
  Overall = 'INCOMPLETE'
  Limitations = @()
}

foreach ($path in @($InstallerPath, $BaseTauriConfigPath, $HomologationTauriConfigPath, $BuildScriptPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Arquivo de entrada ausente: $path" }
}

$installerItem = Get-Item -LiteralPath $InstallerPath
$report.Installer.Exists = $true
$report.Installer.Sha256 = Get-Sha256 $InstallerPath
$report.Installer.Length = $installerItem.Length
$report.Installer.ProductName = $installerItem.VersionInfo.ProductName
$report.Installer.ProductVersion = $installerItem.VersionInfo.ProductVersion

if ($ExecutablePath -and (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  $exeItem = Get-Item -LiteralPath $ExecutablePath
  $report.ExecutableSource.Exists = $true
  $report.ExecutableSource.Sha256 = Get-Sha256 $ExecutablePath
  $report.ExecutableSource.Length = $exeItem.Length
} else {
  $report.Limitations += 'Executável de origem da mesma compilação não foi fornecido; o vínculo hash executável↔instalador não pode ser confirmado.'
}

$report.BuildInputs.BaseConfigSha256 = Get-Sha256 $BaseTauriConfigPath
$report.BuildInputs.HomologationConfigSha256 = Get-Sha256 $HomologationTauriConfigPath
$report.BuildInputs.BuildScriptSha256 = Get-Sha256 $BuildScriptPath
$buildScriptText = Get-Content -LiteralPath $BuildScriptPath -Raw
$report.BuildInputs.BuildScriptSelectsHomologationConfig = $buildScriptText.Contains('--config src-tauri/tauri.homologacao.conf.json')
$effective = Get-EffectiveConfig
$report.BuildInputs.EffectiveConfig = Get-ConfigEvidence $effective
if ($CapabilitiesManifestPath -and (Test-Path -LiteralPath $CapabilitiesManifestPath -PathType Leaf)) {
  $report.BuildInputs.CapabilitiesManifestSha256 = Get-Sha256 $CapabilitiesManifestPath
  $manifest = Get-Content -LiteralPath $CapabilitiesManifestPath -Raw | ConvertFrom-Json
  $compiledCapabilityProperty = $manifest.PSObject.Properties['homologacao-window-close']
  $compiledCapability = if ($compiledCapabilityProperty) { $compiledCapabilityProperty.Value } else { $null }
  $report.BuildInputs.CompiledCapability = [ordered]@{
    Present = [bool]$compiledCapability
    Windows = if ($compiledCapability) { @($compiledCapability.windows) } else { @() }
    Permissions = if ($compiledCapability) { @($compiledCapability.permissions) } else { @() }
    HasAllowClose = [bool]($compiledCapability -and @($compiledCapability.permissions) -contains 'core:window:allow-close')
    AppliesToMain = [bool]($compiledCapability -and @($compiledCapability.windows) -contains 'main')
  }
} else {
  $report.Limitations += 'Manifesto de capabilities da mesma compilação não foi fornecido; permissões incorporadas não podem ser confirmadas.'
}

try {
  $sevenZip = Find-SevenZip
  $embedded = Get-EmbeddedExecutable $sevenZip $InstallerPath
  $report.EmbeddedExecutable.Verified = $true
  $report.EmbeddedExecutable.MemberPath = $embedded.MemberPath
  $report.EmbeddedExecutable.Sha256 = $embedded.Sha256
  $report.EmbeddedExecutable.Length = $embedded.Length
  $report.EmbeddedExecutable.MatchesSourceExecutable = ($embedded.Sha256 -eq $report.ExecutableSource.Sha256)
} catch {
  $report.Limitations += $_.Exception.Message
}

$configEvidence = $report.BuildInputs.EffectiveConfig
$configCorrect = $configEvidence.Identifier -eq 'com.apamind.homologacao' -and
  $configEvidence.ProductName -eq 'ApaMind Homologação' -and
  $configEvidence.Version -eq '0.7.1' -and
  $configEvidence.WithGlobalTauri -and
  @($configEvidence.WindowLabels) -contains 'main' -and
  $configEvidence.InlineCloseCapabilityPresent -and
  @($configEvidence.InlineCloseCapabilityWindows) -contains 'main' -and
  @($configEvidence.InlineCloseCapabilityPermissions) -contains 'core:window:allow-close'
$compiledCorrect = $report.BuildInputs.CompiledCapability.Present -and $report.BuildInputs.CompiledCapability.HasAllowClose -and $report.BuildInputs.CompiledCapability.AppliesToMain
if ($report.EmbeddedExecutable.Verified -and $report.EmbeddedExecutable.MatchesSourceExecutable -and $configCorrect -and $compiledCorrect -and $report.BuildInputs.BuildScriptSelectsHomologationConfig) {
  $report.Overall = 'VERIFIED'
} else {
  $report.Overall = 'INCOMPLETE_OR_MISMATCH'
}

$report | ConvertTo-Json -Depth 10
if ($report.Overall -ne 'VERIFIED') { exit 2 }
