$ErrorActionPreference = "Stop"

$mainRepo = "C:\Users\-\Desktop\DESENVOLVIMENTO\ApaMind"
$worktree = "C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree"
$outputDir = "C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1"
$updatedHomologationOutputDir = Join-Path $env:TEMP "ApaMind-Homologacao-0.7.1-label-main"
$diagnosticOutputDir = Join-Path $env:TEMP "ApaMind-Homologacao-Diagnostico-0.7.1"
$updatedDiagnosticOutputDir = Join-Path $env:TEMP "ApaMind-Homologacao-Diagnostico-0.7.1-label-main"
$localData = Join-Path $env:LOCALAPPDATA "com.apamind.homologacao"
$webViewData = Join-Path $localData "webview2"
$roamingData = Join-Path $env:APPDATA "com.apamind.homologacao"
$installDir = Join-Path $env:LOCALAPPDATA "ApaMind Homologação"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "ApaMind Homologação.lnk"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\ApaMind Homologação"
$startMenuShortcut = Join-Path $startMenuDir "ApaMind Homologação.lnk"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ApaMind Homologação"
$diagnosticLocalData = Join-Path $env:LOCALAPPDATA "com.apamind.homologacao.diagnostico"
$diagnosticWebViewData = Join-Path $diagnosticLocalData "webview2"
$diagnosticRoamingData = Join-Path $env:APPDATA "com.apamind.homologacao.diagnostico"
$diagnosticInstallDir = Join-Path $env:LOCALAPPDATA "ApaMind Homologação Diagnóstico"
$diagnosticDesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "ApaMind Homologação Diagnóstico.lnk"
$diagnosticStartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\ApaMind Homologação Diagnóstico"
$diagnosticStartMenuShortcut = Join-Path $diagnosticStartMenuDir "ApaMind Homologação Diagnóstico.lnk"
$diagnosticUninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ApaMind Homologação Diagnóstico"

$approvedPaths = @(
  $localData, $webViewData, $roamingData, $installDir, $desktopShortcut, $startMenuShortcut, $startMenuDir,
  $diagnosticLocalData, $diagnosticWebViewData, $diagnosticRoamingData, $diagnosticInstallDir,
  $diagnosticDesktopShortcut, $diagnosticStartMenuShortcut, $diagnosticStartMenuDir,
  $outputDir, $updatedHomologationOutputDir, $diagnosticOutputDir, $updatedDiagnosticOutputDir, $worktree
)
$canonicalApprovedPaths = @($approvedPaths | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd([char]92) })
foreach ($path in $approvedPaths) {
  $fullPath = [IO.Path]::GetFullPath($path).TrimEnd([char]92)
  if ($fullPath -match "(?i)com\.apamind\.desktop") {
    throw "Recusado: caminho associado à versão normal: $fullPath"
  }
  if ($fullPath -notin $canonicalApprovedPaths) { throw "Caminho não autorizado para remoção: $fullPath" }
}

Write-Output "Alvos exclusivos da homologação que podem ser removidos:"
$approvedPaths | ForEach-Object { Write-Output " - $_" }
Write-Output "Branch Git: temp/homologacao-apamind (somente no repositório $mainRepo)"

$recursiveTargets = @(
  $localData, $roamingData, $installDir, $startMenuDir,
  $diagnosticLocalData, $diagnosticRoamingData, $diagnosticInstallDir, $diagnosticStartMenuDir,
  $outputDir, $updatedHomologationOutputDir, $diagnosticOutputDir, $updatedDiagnosticOutputDir, $worktree
)
Write-Output "Conteúdo existente que será removido junto com esses diretórios:"
foreach ($path in $recursiveTargets) {
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Recusado: o alvo é um link/reparse point e não pode ser validado como dados exclusivos: $path"
    }
    Write-Output "[$($item.FullName)]"
    if ($item.PSIsContainer) {
      Get-ChildItem -LiteralPath $path -Force -Recurse | ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          throw "Recusado: há um link/reparse point dentro do alvo: $($_.FullName)"
        }
        Write-Output $_.FullName
      }
    }
  } else {
    Write-Output "[ausente] $path"
  }
}
if (-not (Test-Path -LiteralPath $desktopShortcut)) { Write-Output "[ausente] $desktopShortcut" }

if (Test-Path -LiteralPath $uninstallKey) {
  throw "ApaMind Homologação ainda consta instalada. Desinstale-a pelo Windows antes de apagar os dados."
}
if (Test-Path -LiteralPath $diagnosticUninstallKey) {
  throw "ApaMind Homologação Diagnóstico ainda consta instalada. Desinstale-a pelo Windows antes de apagar os dados."
}
$repoRoot = (& git -C $mainRepo rev-parse --show-toplevel).Trim().Replace('/', '\').TrimEnd([char]92)
if ($LASTEXITCODE -ne 0 -or $repoRoot -ne $mainRepo.TrimEnd([char]92)) { throw "Repositório original não corresponde ao caminho esperado." }
$worktrees = & git -c "safe.directory=$mainRepo" -c "safe.directory=$worktree" -C $mainRepo worktree list --porcelain
$expectedWorktreeRecord = "worktree $worktree"
$expectedBranchRecord = "branch refs/heads/temp/homologacao-apamind"
$normalizedWorktrees = @($worktrees | ForEach-Object { $_ -replace '/', '\' })
if ($normalizedWorktrees -notcontains $expectedWorktreeRecord -or $normalizedWorktrees -notcontains $expectedBranchRecord) {
  throw "O caminho/branch não correspondem ao worktree temporário esperado; nenhum arquivo foi removido."
}

$confirmation = Read-Host "Para confirmar, digite exatamente REMOVER HOMOLOGACAO"
if ($confirmation -cne "REMOVER HOMOLOGACAO") { throw "Cancelado; nada foi removido." }

foreach ($path in @(
  $webViewData, $localData, $roamingData, $installDir, $desktopShortcut, $startMenuShortcut,
  $diagnosticWebViewData, $diagnosticLocalData, $diagnosticRoamingData, $diagnosticInstallDir,
  $diagnosticDesktopShortcut, $diagnosticStartMenuShortcut,
  $outputDir, $updatedHomologationOutputDir, $diagnosticOutputDir, $updatedDiagnosticOutputDir
)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
if ((Test-Path -LiteralPath $startMenuDir) -and @(Get-ChildItem -LiteralPath $startMenuDir -Force).Count -eq 0) {
  Remove-Item -LiteralPath $startMenuDir -Force
}
if ((Test-Path -LiteralPath $diagnosticStartMenuDir) -and @(Get-ChildItem -LiteralPath $diagnosticStartMenuDir -Force).Count -eq 0) {
  Remove-Item -LiteralPath $diagnosticStartMenuDir -Force
}
Push-Location $mainRepo
try {
  & git -c "safe.directory=$mainRepo" -c "safe.directory=$worktree" worktree remove --force $worktree
  if ($LASTEXITCODE -ne 0) { throw "Falha ao remover o worktree temporário." }
  & git -c "safe.directory=$mainRepo" branch -D temp/homologacao-apamind
  if ($LASTEXITCODE -ne 0) { throw "Falha ao remover a branch temporária." }
} finally {
  Pop-Location
}
Write-Output "Dados e artefatos exclusivos da homologação removidos. Confira git status no repositório original."
