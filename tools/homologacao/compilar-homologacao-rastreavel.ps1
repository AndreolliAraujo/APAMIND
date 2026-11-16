param(
  [string] $Worktree = (Join-Path $PSScriptRoot "..\.."),
  [string] $OutputRoot = (Join-Path $env:LOCALAPPDATA 'Temp'),
  [string] $SevenZipPath = '',
  [switch] $AuditExistingArtifacts,
  [string] $ExistingRunRoot = ''
)

$ErrorActionPreference = 'Stop'
$Worktree = (Resolve-Path -LiteralPath $Worktree).Path
$expectedBranch = 'main'
$runId = [guid]::NewGuid().ToString('N')
$runRoot = Join-Path $OutputRoot "ApaMind-Homologacao-Rastreavel-$runId"
$stagedRoot = Join-Path $runRoot 'source'
$targetDir = Join-Path $runRoot 'cargo-target'
$frontendDir = Join-Path $runRoot 'frontend'
$scratchDir = Join-Path $runRoot 'scratch'
$manifestPath = Join-Path $runRoot 'manifesto-auditoria.json'
$buildLog = Join-Path $runRoot 'build.log'
$buildStdoutLog = Join-Path $runRoot 'build.stdout.log'
$buildStderrLog = Join-Path $runRoot 'build.stderr.log'
$bundleLog = Join-Path $runRoot 'bundle.log'
$bundleStdoutLog = Join-Path $runRoot 'bundle.stdout.log'
$bundleStderrLog = Join-Path $runRoot 'bundle.stderr.log'
$overlayPath = Join-Path $runRoot 'tauri-auditoria-overlay.json'
$effectiveConfigPath = Join-Path $runRoot 'tauri-config-efetiva.json'
$cliPath = Join-Path $stagedRoot 'node_modules/@tauri-apps/cli/tauri.js'
$baseConfigPath = Join-Path $stagedRoot 'src-tauri/tauri.conf.json'
$homologationConfigPath = Join-Path $stagedRoot 'src-tauri/tauri.homologacao.conf.json'
$normalConfigPath = Join-Path $Worktree 'src-tauri/tauri.conf.json'
$savedEnvironment = @{}

function Get-Sha256([string] $Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-SelectedRustToolchainBin([string] $ProjectRoot) {
  $rustupHome = $env:RUSTUP_HOME
  if (-not $rustupHome) { $rustupHome = Join-Path $env:USERPROFILE '.rustup' }
  if (-not (Test-Path -LiteralPath $rustupHome -PathType Container)) {
    throw "RUSTUP_HOME não existe ou não está acessível: $rustupHome"
  }

  $settingsPath = Join-Path $rustupHome 'settings.toml'
  $settingsText = if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
    [IO.File]::ReadAllText($settingsPath)
  } else { '' }
  $defaultMatch = [regex]::Match($settingsText, '(?m)^\s*default_toolchain\s*=\s*"((?:[^"\\]|\\.)*)"')
  $hostMatch = [regex]::Match($settingsText, '(?m)^\s*default_host_tuple\s*=\s*"((?:[^"\\]|\\.)*)"')
  $defaultToolchain = if ($defaultMatch.Success) { $defaultMatch.Groups[1].Value } else { $null }
  $defaultHost = if ($hostMatch.Success) { $hostMatch.Groups[1].Value } else { $null }

  $decodeTomlBasicString = {
    param([string] $Value, [string] $Context)
    $builder = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt $Value.Length; $index++) {
      if ($Value[$index] -ne '\') { [void]$builder.Append($Value[$index]); continue }
      $index++
      if ($index -ge $Value.Length) { throw "Escape TOML incompleto em $Context" }
      switch ($Value[$index]) {
        '"' { [void]$builder.Append('"') }
        '\' { [void]$builder.Append('\') }
        'b' { [void]$builder.Append([char]8) }
        't' { [void]$builder.Append([char]9) }
        'n' { [void]$builder.Append([char]10) }
        'f' { [void]$builder.Append([char]12) }
        'r' { [void]$builder.Append([char]13) }
        default { throw "Escape TOML não suportado em $Context; seleção do toolchain ambígua." }
      }
    }
    return $builder.ToString()
  }

  $directoryOverrides = @{}
  $inOverrides = $false
  foreach ($line in ($settingsText -split "`r?`n")) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed -match '^\[([^\]]+)\]\s*(?:#.*)?$') {
      $inOverrides = ($Matches[1] -eq 'overrides')
      continue
    }
    if (-not $inOverrides) { continue }
    $pair = [regex]::Match($trimmed, '^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$')
    if (-not $pair.Success) {
      throw "Entrada de directory override não reconhecida em ${settingsPath}: $trimmed"
    }
    $overridePath = & $decodeTomlBasicString $pair.Groups[1].Value $settingsPath
    $overrideName = & $decodeTomlBasicString $pair.Groups[2].Value $settingsPath
    if (-not $overridePath -or -not $overrideName) {
      throw "Directory override vazio em $settingsPath; seleção do toolchain ambígua."
    }
    if ([IO.Path]::IsPathRooted($overrideName)) {
      throw "Directory override contém caminho, mas Rustup espera um nome de toolchain: $overrideName"
    }
    $normalizedOverridePath = [IO.Path]::GetFullPath($overridePath).TrimEnd('\')
    if ($directoryOverrides.ContainsKey($normalizedOverridePath)) {
      throw "Directory override duplicado para '$normalizedOverridePath' em $settingsPath."
    }
    $directoryOverrides[$normalizedOverridePath] = $overrideName
  }

  $toolchainName = $env:RUSTUP_TOOLCHAIN
  if ($null -ne $toolchainName) {
    if (-not $toolchainName.Trim()) { throw 'RUSTUP_TOOLCHAIN está definido, mas vazio.' }
  } else {
    $probe = [IO.Path]::GetFullPath($ProjectRoot)
    while ($probe) {
      $normalizedProbe = [IO.Path]::GetFullPath($probe).TrimEnd('\')
      if ($directoryOverrides.ContainsKey($normalizedProbe)) {
        $toolchainName = $directoryOverrides[$normalizedProbe]
        break
      }

      $plainPath = Join-Path $probe 'rust-toolchain'
      $tomlPath = Join-Path $probe 'rust-toolchain.toml'
      if (Test-Path -LiteralPath $plainPath -PathType Leaf) {
        $toolchainText = [IO.File]::ReadAllText($plainPath)
        $toolchainLines = @($toolchainText -split "`r?`n")
        if ($toolchainLines.Count -eq 1) {
          $toolchainName = $toolchainLines[0].Trim()
          if (-not $toolchainName) { throw "Arquivo toolchain vazio: $plainPath" }
        } else {
          $toolchainFile = $plainPath
          $toolchainToml = $true
        }
        break
      }
      if (Test-Path -LiteralPath $tomlPath -PathType Leaf) {
        $toolchainFile = $tomlPath
        $toolchainToml = $true
        break
      }
      $parent = Split-Path -Parent $probe
      if (-not $parent -or $parent -eq $probe) { break }
      $probe = $parent
    }

    if ($toolchainToml) {
      $section = ''
      $toolchainSectionFound = $false
      $toolchainFields = @{}
      $skipArray = $false
      foreach ($line in ([IO.File]::ReadAllText($toolchainFile) -split "`r?`n")) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($skipArray) {
          if ($trimmed -match '\]\s*(?:#.*)?$') { $skipArray = $false }
          continue
        }
        if ($trimmed -match '^\[([^\]]+)\]\s*(?:#.*)?$') {
          $section = $Matches[1]
          if ($section -eq 'toolchain') {
            if ($toolchainSectionFound) { throw "Seção [toolchain] duplicada em $toolchainFile" }
            $toolchainSectionFound = $true
          }
          continue
        }
        if ($section -ne 'toolchain') { continue }
        $field = [regex]::Match($trimmed, '^(channel|path)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$')
        if ($field.Success) {
          $key = $field.Groups[1].Value
          if ($toolchainFields.ContainsKey($key)) { throw "Campo '$key' duplicado em $toolchainFile" }
          $toolchainFields[$key] = & $decodeTomlBasicString $field.Groups[2].Value $toolchainFile
          continue
        }
        if ($trimmed -match '^(components|targets)\s*=\s*\[') {
          if ($trimmed -notmatch '\]\s*(?:#.*)?$') { $skipArray = $true }
          continue
        }
        if ($trimmed -match '^profile\s*=\s*"[^"\\]*"\s*(?:#.*)?$') { continue }
        throw "Campo TOML não reconhecido na seção [toolchain] de ${toolchainFile}: $trimmed"
      }
      if ($skipArray) { throw "Array components/targets não foi fechado em $toolchainFile" }
      if (-not $toolchainSectionFound) { throw "Seção [toolchain] ausente em $toolchainFile" }
      if ($toolchainFields.ContainsKey('channel') -and $toolchainFields.ContainsKey('path')) {
        throw "channel e path aparecem juntos em $toolchainFile; Rustup rejeitaria essa configuração."
      }
      if ($toolchainFields.ContainsKey('path')) {
        $toolchainName = $toolchainFields['path']
        if (-not $toolchainName) { throw "Campo path vazio em $toolchainFile" }
        if (-not [IO.Path]::IsPathRooted($toolchainName)) {
          throw "O path de toolchain em $toolchainFile não é absoluto."
        }
      } elseif ($toolchainFields.ContainsKey('channel')) {
        $toolchainName = $toolchainFields['channel']
        if (-not $toolchainName) { throw "Campo channel vazio em $toolchainFile" }
        if ([IO.Path]::IsPathRooted($toolchainName)) {
          throw "channel em $toolchainFile deve ser nome de toolchain, não caminho."
        }
      }
    }

    if (-not $toolchainName) {
      if ($defaultToolchain -and [IO.Path]::IsPathRooted($defaultToolchain)) {
        throw "default_toolchain contém caminho, não um nome Rustup válido."
      }
      $toolchainName = $defaultToolchain
    }
    if (-not $toolchainName) {
      throw "Nenhum override ou default_toolchain foi encontrado em $settingsPath."
    }
  }

  if ([IO.Path]::IsPathRooted($toolchainName) -and $toolchainName -match '^[A-Za-z]:[^\\/]') {
    throw "Toolchain '$toolchainName' usa um caminho relativo à unidade; seleção ambígua."
  }
  if ([IO.Path]::IsPathRooted($toolchainName)) {
    $toolchainRoot = [IO.Path]::GetFullPath($toolchainName)
  } else {
    $toolchainsRoot = Join-Path $rustupHome 'toolchains'
    $exactCandidate = Join-Path $toolchainsRoot $toolchainName
    if (Test-Path -LiteralPath $exactCandidate -PathType Container) {
      $toolchainRoot = $exactCandidate
    } elseif ($defaultHost) {
      $hostCandidate = Join-Path $toolchainsRoot ($toolchainName + '-' + $defaultHost)
      if (Test-Path -LiteralPath $hostCandidate -PathType Container) { $toolchainRoot = $hostCandidate }
    } else {
      $hostCandidates = @(Get-ChildItem -LiteralPath $toolchainsRoot -Directory -ErrorAction Stop |
        Where-Object { $_.Name.StartsWith($toolchainName + '-', [StringComparison]::OrdinalIgnoreCase) })
      if ($hostCandidates.Count -eq 1) { $toolchainRoot = $hostCandidates[0].FullName }
      elseif ($hostCandidates.Count -gt 1) {
        throw "Mais de um toolchain instalado corresponde a '$toolchainName' e default_host_tuple está ausente."
      }
    }
  }
  if (-not $toolchainRoot -or -not (Test-Path -LiteralPath $toolchainRoot -PathType Container)) {
    throw "Toolchain '$toolchainName' não está instalado ou não é um diretório válido."
  }
  $bin = Join-Path $toolchainRoot 'bin'
  foreach ($binary in @('rustc.exe', 'cargo.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $bin $binary) -PathType Leaf)) {
      throw "Executável Rust necessário não existe: $(Join-Path $bin $binary)"
    }
  }
  return $bin
}

function Get-ExecutableVersion([string] $ExecutablePath) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $ExecutablePath
  $start.Arguments = '--version'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "Não foi possível consultar a versão: $ExecutablePath" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
  $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
  $exitCode = $process.ExitCode
  $process.Dispose()
  if ($exitCode -ne 0) { throw "'$ExecutablePath --version' retornou código $exitCode. $stderr" }
  if ($stderr) { throw "'$ExecutablePath --version' escreveu em stderr: $stderr" }
  if (-not $stdout) { throw "'$ExecutablePath --version' não retornou uma versão." }
  return $stdout
}

function ConvertTo-WindowsCommandLineArgument([string] $Argument) {
  if ($null -eq $Argument) { throw 'Argumento de processo nulo.' }
  if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') { return $Argument }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Argument.ToCharArray()) {
    if ($character -eq '\') { $backslashes++; continue }
    if ($character -eq '"') {
      [void]$builder.Append([string]::new('\', (2 * $backslashes) + 1))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) { [void]$builder.Append([string]::new('\', $backslashes)) }
    [void]$builder.Append($character)
    $backslashes = 0
  }
  if ($backslashes -gt 0) { [void]$builder.Append([string]::new('\', 2 * $backslashes)) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Invoke-CapturedProcess(
  [string] $FilePath,
  [string[]] $Arguments,
  [string] $WorkingDirectory,
  [string] $CombinedLogPath,
  [string] $StdoutLogPath,
  [string] $StderrLogPath
) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  foreach ($logPath in @($CombinedLogPath, $StdoutLogPath, $StderrLogPath)) {
    [IO.File]::WriteAllText($logPath, '', $utf8)
  }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsCommandLineArgument ([string]$_) }) -join ' ')
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $started = $false
  $exitCode = $null
  $stdout = ''
  $stderr = ''
  $failure = $null
  $stdoutTask = $null
  $stderrTask = $null
  try {
    if (-not $process.Start()) { throw "Process.Start retornou false para '$FilePath'." }
    $started = $true
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
  } catch {
    $failure = $_.Exception.ToString()
    if ($started) {
      try {
        if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
      } catch { $failure += "`r`nFalha ao encerrar processo após erro: $($_.Exception.ToString())" }
      if ($stdoutTask) { try { $stdout = $stdoutTask.GetAwaiter().GetResult() } catch {} }
      if ($stderrTask) { try { $stderr = $stderrTask.GetAwaiter().GetResult() } catch {} }
      if ($process.HasExited) { $exitCode = $process.ExitCode }
    }
  } finally {
    $timer.Stop()
    $process.Dispose()
  }

  if ($started -and $null -eq $exitCode -and -not $failure) {
    $failure = 'Processo terminou a espera sem disponibilizar código de saída.'
  }
  $combined = "=== STDOUT ===`r`n$stdout`r`n=== STDERR ===`r`n$stderr"
  [IO.File]::WriteAllText($StdoutLogPath, $stdout, $utf8)
  [IO.File]::WriteAllText($StderrLogPath, $stderr, $utf8)
  [IO.File]::WriteAllText($CombinedLogPath, $combined, $utf8)

  [pscustomobject]@{
    ProcessStarted = $started
    ExitCode = $exitCode
    DurationMilliseconds = $timer.ElapsedMilliseconds
    Failure = $failure
    Stdout = $stdout
    Stderr = $stderr
  }
}

function Get-GitValue([string[]] $GitArgs) {
  $result = & git -c "safe.directory=$Worktree" -C $Worktree @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') falhou: $($result -join ' ')" }
  return @($result | ForEach-Object { [string]$_ })
}

function Get-GitFileList {
  @(Get-GitValue @('ls-files', '--cached', '--others', '--exclude-standard'))
}

function Get-SourceSnapshot {
  $hashes = [ordered]@{}
  foreach ($relativePath in (Get-GitFileList)) {
    $path = Join-Path $Worktree $relativePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $hashes[$relativePath] = Get-Sha256 $path
    } elseif (Test-Path -LiteralPath $path -PathType Container) {
      $hashes[$relativePath] = 'DIRECTORY'
    } else {
      $hashes[$relativePath] = 'MISSING'
    }
  }
  [ordered]@{
    Branch = (Get-GitValue @('branch', '--show-current') | Select-Object -First 1)
    Commit = (Get-GitValue @('rev-parse', 'HEAD') | Select-Object -First 1)
    StatusPorcelain = @(Get-GitValue @('status', '--porcelain=v1', '--untracked-files=all'))
    FileHashes = $hashes
  }
}

function Copy-TrackedAndLocalFiles([string] $Destination) {
  foreach ($relativePath in (Get-GitFileList)) {
    $sourcePath = Join-Path $Worktree $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
    $destinationPath = Join-Path $Destination $relativePath
    $destinationParent = Split-Path -Parent $destinationPath
    if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
      New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }
}

function Copy-InstalledNodeModules([string] $Source, [string] $Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "node_modules ausente: $Source" }
  $reparsePoints = @(Get-ChildItem -LiteralPath $Source -Force -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue)
  if ($reparsePoints.Count -gt 0) {
    throw "node_modules contém links/reparse points; cópia isolada não pode ser garantida. Primeiro item: $($reparsePoints[0].FullName)"
  }
  $null = New-Item -ItemType Directory -Path $Destination -Force
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:0 /W:0 /XJ /NFL /NDL /NJH /NJS
  $robocopyCode = $LASTEXITCODE
  if ($robocopyCode -ge 8) { throw "Cópia isolada de node_modules falhou (robocopy $robocopyCode)." }
  if (-not (Test-Path -LiteralPath (Join-Path $Destination '@tauri-apps/cli/tauri.js') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $Destination 'vite/bin/vite.js') -PathType Leaf)) {
    throw 'A cópia temporária de node_modules não contém o Tauri CLI e o Vite esperados.'
  }
}

function Merge-JsonPatch($Base, $Patch) {
  $merged = [ordered]@{}
  foreach ($property in $Base.PSObject.Properties) { $merged[$property.Name] = $property.Value }
  foreach ($property in $Patch.PSObject.Properties) {
    if ($null -eq $property.Value) {
      $merged.Remove($property.Name)
      continue
    }
    $old = $Base.PSObject.Properties[$property.Name]
    if ($old -and $old.Value -is [pscustomobject] -and $property.Value -is [pscustomobject]) {
      $merged[$property.Name] = Merge-JsonPatch $old.Value $property.Value
    } else {
      $merged[$property.Name] = $property.Value
    }
  }
  return [pscustomobject]$merged
}

function Resolve-SevenZip {
  if ($SevenZipPath) {
    if (Test-Path -LiteralPath $SevenZipPath -PathType Leaf) { return (Resolve-Path -LiteralPath $SevenZipPath).Path }
    throw "O caminho de 7-Zip informado não existe: $SevenZipPath"
  }
  $command = Get-Command 7z.exe, 7z, 7za.exe, 7za, 7zz.exe, 7zz -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles '7-Zip/7z.exe'),
    (Join-Path ${env:ProgramFiles(x86)} '7-Zip/7z.exe')
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }
  return $null
}

function Get-EmbeddedExecutableHash([string] $SevenZip, [string] $Installer) {
  $listing = & $SevenZip l -slt $Installer 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível listar o NSIS com 7-Zip: $($listing -join ' ')" }
  $members = @($listing | ForEach-Object { if ([string]$_ -match '^Path = (.+)$') { $Matches[1] } } |
    Where-Object { [IO.Path]::GetFileName($_) -ieq 'apamind-homologacao.exe' })
  if ($members.Count -ne 1) { throw "Esperado um executável apamind-homologacao.exe no NSIS; encontrados $($members.Count): $($members -join ', ')" }

  $quotedInstaller = '"' + $Installer.Replace('"', '\"') + '"'
  $quotedMember = '"' + $members[0].Replace('"', '\"') + '"'
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $SevenZip
  $start.Arguments = "x -so -y $quotedInstaller $quotedMember"
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'Não foi possível iniciar 7-Zip para extração em fluxo.' }
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
  $buffer = New-Object byte[] 65536
  [int64]$length = 0
  try {
    while (($read = $process.StandardOutput.BaseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $hash.AppendData($buffer, 0, $read)
      $length += $read
    }
    $process.WaitForExit()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Extração em fluxo falhou ($($process.ExitCode)): $stderr" }
    if ($length -eq 0) { throw 'Executável extraído vazio.' }
    [pscustomobject]@{
      MemberPath = $members[0]
      Length = $length
      Sha256 = [BitConverter]::ToString($hash.GetHashAndReset()).Replace('-', '')
    }
  } finally {
    $hash.Dispose()
    $process.Dispose()
  }
}

function Extract-EmbeddedExecutableToFile([string] $SevenZip, [string] $Installer, [string] $Member, [string] $DestinationDirectory) {
  if (Test-Path -LiteralPath $DestinationDirectory) { throw "Pasta de extracao ja existe; recusando sobrescrita: $DestinationDirectory" }
  New-Item -ItemType Directory -Path $DestinationDirectory | Out-Null
  $quoteArg = { param([string]$Value) '"' + $Value.Replace('"', '\"') + '"' }
  $arguments = 'x -y -o' + (& $quoteArg $DestinationDirectory) + ' ' + (& $quoteArg $Installer) + ' ' + (& $quoteArg $Member)
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $SevenZip
  $start.Arguments = $arguments
  $start.WorkingDirectory = $DestinationDirectory
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'Nao foi possivel iniciar a extracao do executavel do NSIS.' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
  $process.Dispose()
  if ($exitCode -ne 0) { throw "Extracao do executavel do NSIS falhou ($exitCode): $stderr" }
  $destination = Join-Path $DestinationDirectory ([IO.Path]::GetFileName($Member))
  if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Executavel extraido ausente: $destination" }
  [pscustomobject]@{ Path = $destination; ExitCode = $exitCode; Stdout = $stdout; Stderr = $stderr; Arguments = $arguments }
}

function Test-ExpectedTauriBundleMarkerTransform([string] $OriginalPath, [string] $PayloadPath, [string] $PatchedCopyPath) {
  if (Test-Path -LiteralPath $PatchedCopyPath) { throw "Copia patched ja existe; recusando sobrescrita: $PatchedCopyPath" }
  $originalShaBefore = Get-Sha256 $OriginalPath
  $originalBytes = [IO.File]::ReadAllBytes($OriginalPath)
  $oldMarker = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_UNK')
  $newMarker = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS')
  $oldOffsets = @(Get-BytePatternOffsets $originalBytes $oldMarker)
  $newOffsetsInOriginal = @(Get-BytePatternOffsets $originalBytes $newMarker)
  if ($oldOffsets.Count -ne 1 -or $newOffsetsInOriginal.Count -ne 0) {
    throw "Marcador Tauri esperado uma vez e marcador transformado ausente; UNK=$($oldOffsets.Count), NSS=$($newOffsetsInOriginal.Count)."
  }
  $markerOffset = [int]$oldOffsets[0]
  $replacementOffset = $markerOffset + $oldMarker.Length - 3
  if ([BitConverter]::ToString($originalBytes[$replacementOffset..($replacementOffset + 2)]).Replace('-', '') -ne '554E4B') {
    throw 'Os bytes UNK do marcador Tauri nao correspondem ao valor documentado.'
  }
  [IO.File]::WriteAllBytes($PatchedCopyPath, $originalBytes)
  $patchedBytes = [IO.File]::ReadAllBytes($PatchedCopyPath)
  $patchedBytes[$replacementOffset] = 0x4E
  $patchedBytes[$replacementOffset + 1] = 0x53
  $patchedBytes[$replacementOffset + 2] = 0x53
  [IO.File]::WriteAllBytes($PatchedCopyPath, $patchedBytes)
  $originalVsPatched = Compare-BinaryFiles $OriginalPath $PatchedCopyPath
  $expectedOffsets = @($replacementOffset, ($replacementOffset + 1), ($replacementOffset + 2))
  $actualOffsets = @($originalVsPatched.Differences | ForEach-Object { $_.Offset })
  $onlyExpectedDifferences = $originalVsPatched.LeftLength -eq $originalVsPatched.RightLength -and
    $originalVsPatched.DifferenceCount -eq 3 -and
    (($actualOffsets -join ',') -ceq ($expectedOffsets -join ',')) -and
    ((@($originalVsPatched.Differences | ForEach-Object { $_.LeftHex }) -join '') -eq '554E4B') -and
    ((@($originalVsPatched.Differences | ForEach-Object { $_.RightHex }) -join '') -eq '4E5353')
  $newOffsetsInPatched = @(Get-BytePatternOffsets $patchedBytes $newMarker)
  if (-not $onlyExpectedDifferences -or $newOffsetsInPatched.Count -ne 1) {
    throw 'A copia temporaria contem alteracoes alem da substituicao exata dos tres bytes UNK para NSS.'
  }
  $patchedVsPayload = Compare-BinaryFiles $PatchedCopyPath $PayloadPath
  if ($patchedVsPayload.LeftLength -ne $patchedVsPayload.RightLength -or $patchedVsPayload.DifferenceCount -ne 0) {
    throw "Executavel do NSIS difere da copia com a transformacao documentada em $($patchedVsPayload.DifferenceCount) bytes."
  }
  $originalShaAfter = Get-Sha256 $OriginalPath
  [pscustomobject]@{
    OriginalMarkerCount = $oldOffsets.Count
    TransformedMarkerCountInOriginal = $newOffsetsInOriginal.Count
    TransformedMarkerCountInPatchedCopy = $newOffsetsInPatched.Count
    MarkerByteOffset = $markerOffset
    ReplacementByteOffset = $replacementOffset
    DifferenceCountOriginalVsPatched = $originalVsPatched.DifferenceCount
    DifferencesOriginalVsPatched = @($originalVsPatched.Differences)
    PatchedCopyVsPayloadDifferenceCount = $patchedVsPayload.DifferenceCount
    OriginalSha256Before = $originalShaBefore
    PatchedCopySha256 = Get-Sha256 $PatchedCopyPath
    PayloadSha256 = Get-Sha256 $PayloadPath
    PayloadLength = (Get-Item -LiteralPath $PayloadPath).Length
    OriginalSha256After = $originalShaAfter
    OriginalUnchanged = ($originalShaBefore -eq $originalShaAfter)
    OnlyDocumentedThreeBytesChanged = [bool]$onlyExpectedDifferences
    PayloadMatchesPatchedCopy = $true
  }
}

function Restore-ProcessEnvironment {
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
}

function Get-BytePatternOffsets([byte[]] $Bytes, [byte[]] $Pattern) {
  $offsets = New-Object 'System.Collections.Generic.List[int]'
  if ($Pattern.Length -eq 0 -or $Bytes.Length -lt $Pattern.Length) { return @() }
  for ($offset = 0; $offset -le $Bytes.Length - $Pattern.Length; $offset++) {
    $match = $true
    for ($index = 0; $index -lt $Pattern.Length; $index++) {
      if ($Bytes[$offset + $index] -ne $Pattern[$index]) { $match = $false; break }
    }
    if ($match) { $offsets.Add($offset) }
  }
  return @($offsets.ToArray())
}

function Compare-BinaryFiles([string] $LeftPath, [string] $RightPath) {
  $left = [IO.File]::ReadAllBytes($LeftPath)
  $right = [IO.File]::ReadAllBytes($RightPath)
  $differences = New-Object 'System.Collections.Generic.List[object]'
  $limit = [Math]::Min($left.Length, $right.Length)
  for ($offset = 0; $offset -lt $limit; $offset++) {
    if ($left[$offset] -ne $right[$offset]) {
      $differences.Add([pscustomobject]@{
        Offset = $offset
        LeftHex = $left[$offset].ToString('X2')
        RightHex = $right[$offset].ToString('X2')
      })
    }
  }
  if ($left.Length -ne $right.Length) {
    for ($offset = $limit; $offset -lt [Math]::Max($left.Length, $right.Length); $offset++) {
      $differences.Add([pscustomobject]@{
        Offset = $offset
        LeftHex = if ($offset -lt $left.Length) { $left[$offset].ToString('X2') } else { $null }
        RightHex = if ($offset -lt $right.Length) { $right[$offset].ToString('X2') } else { $null }
      })
    }
  }
  [pscustomobject]@{
    LeftLength = $left.Length
    RightLength = $right.Length
    DifferenceCount = $differences.Count
    Differences = @($differences.ToArray())
  }
}

function Test-PathWithinDirectory([string] $Path, [string] $Directory) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $fullDirectory = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
  return $fullPath.StartsWith($fullDirectory, [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-ExistingArtifactAudit {
  $auditRoot = $null
  $auditManifestPath = $null
  $audit = [ordered]@{
    SchemaVersion = 1
    AuditMode = 'ExistingArtifactsOnly'
    StartedUtc = [DateTime]::UtcNow.ToString('o')
    Status = 'REPROVADO'
    Worktree = $Worktree
    ExistingRunRoot = $ExistingRunRoot
    PreviousManifestPath = $null
    PreviousManifestSha256 = $null
    AuditDirectory = $null
    AuditManifestPath = $null
    AuditScriptSha256Before = Get-Sha256 $PSCommandPath
    AuditScriptSha256After = $null
    PreviousChecks = [ordered]@{}
    Artifacts = [ordered]@{}
    MarkerTransformation = [ordered]@{
      OriginalMarker = '__TAURI_BUNDLE_TYPE_VAR_UNK'
      TransformedMarker = '__TAURI_BUNDLE_TYPE_VAR_NSS'
      ExpectedMarkerCount = 1
      OriginalMarkerCount = 0
      TransformedMarkerCountInOriginal = 0
      TransformedMarkerCountInPatchedCopy = 0
      MarkerByteOffset = $null
      ReplacementByteOffset = $null
      OriginalSuffixHex = $null
      ReplacementSuffixHex = '4E5353'
      DifferenceCountOriginalVsPatched = $null
      DifferenceOffsetsOriginalVsPatched = @()
    }
    Extraction = [ordered]@{
      ToolPath = $null
      ToolSha256 = $null
      Command = $null
      ExitCode = $null
      StdoutPath = $null
      StderrPath = $null
      ExtractedExecutablePath = $null
      ExtractedExecutableSha256 = $null
      ExtractedExecutableLength = $null
      PreviousExtractionPath = $null
      PreviousExtractionSha256 = $null
      PreviousExtractionMatches = $false
    }
    Files = [ordered]@{
      OriginalExecutablePath = $null
      OriginalExecutableLength = $null
      OriginalExecutableSha256Before = $null
      OriginalExecutableSha256After = $null
      PatchedCopyPath = $null
      PatchedCopySha256 = $null
      InstallerPath = $null
      InstallerSha256Before = $null
      InstallerSha256After = $null
      NsisScriptPath = $null
      NsisScriptSha256Before = $null
      NsisScriptSha256After = $null
      PreviousManifestSha256 = $null
      CompiledCapabilitiesPath = $null
      CompiledCapabilitiesSha256 = $null
      EffectiveConfigPath = $null
      EffectiveConfigSha256 = $null
      NormalConfigPath = $null
      NormalConfigSha256Before = $null
      NormalConfigSha256After = $null
      AuditScriptSha256Before = $null
      AuditScriptSha256After = $null
    }
    Comparisons = [ordered]@{
      OriginalVsPatched = $null
      PatchedCopyVsNsisPayload = $null
      OriginalUnchanged = $false
      InstallerUnchanged = $false
      NsisScriptUnchanged = $false
      NormalConfigUnchanged = $false
      AuditScriptUnchangedDuringAudit = $false
    }
    Checks = [ordered]@{
      PriorAuditChecksPreserved = $false
      PriorArtifactsMatchRecordedHashes = $false
      CapabilityCompiledCorrectly = $false
      CapabilityAllowsCloseAndDestroy = $false
      EffectiveHomologationConfigValid = $false
      NsisFileDirectiveReferencesOriginalExe = $false
      ExtractionCompleted = $false
      OriginalMarkerCountCorrect = $false
      PatchedCopyHasExpectedMarker = $false
      OnlyDocumentedThreeBytesChanged = $false
      ExtractedPayloadMatchesPatchedCopy = $false
      OriginalExecutableUnchanged = $false
      InstallerUnchanged = $false
      NsisScriptUnchanged = $false
      NormalConfigUnchanged = $false
      GitStateUnchangedDuringAudit = $false
      AuditScriptUnchangedDuringAudit = $false
    }
    GitBefore = $null
    GitAfter = $null
    Errors = @()
    FinishedUtc = $null
  }

  try {
    if (-not $ExistingRunRoot) { throw 'AuditExistingArtifacts exige -ExistingRunRoot.' }
    $existingFull = [IO.Path]::GetFullPath($ExistingRunRoot)
    $tempRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Temp'))
    if (-not (Test-PathWithinDirectory $existingFull $tempRoot) -or
        [IO.Path]::GetFileName($existingFull) -notmatch '^ApaMind-Homologacao-Rastreavel-[0-9a-f]{32}$') {
      throw "ExistingRunRoot precisa ser uma pasta exclusiva ApaMind-Homologacao-Rastreavel-* em Temp: $existingFull"
    }
    $priorManifestPath = Join-Path $existingFull 'manifesto-auditoria-final.json'
    if (-not (Test-Path -LiteralPath $priorManifestPath -PathType Leaf)) { throw "Manifesto anterior ausente: $priorManifestPath" }
    $priorManifestBytes = [IO.File]::ReadAllBytes($priorManifestPath)
    $prior = [Text.Encoding]::UTF8.GetString($priorManifestBytes) | ConvertFrom-Json
    $audit.PreviousManifestPath = $priorManifestPath
    $audit.PreviousManifestSha256 = Get-Sha256 $priorManifestPath
    $audit.Files.PreviousManifestSha256 = $audit.PreviousManifestSha256
    $audit.GitBefore = Get-SourceSnapshot
    $auditRoot = Join-Path (Join-Path $existingFull 'forensics') ('audit-marker-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $auditRoot) { throw "Pasta de auditoria ja existe; recusando reuso: $auditRoot" }
    New-Item -ItemType Directory -Path $auditRoot | Out-Null
    $audit.AuditDirectory = $auditRoot
    $auditManifestPath = Join-Path $auditRoot 'manifesto-auditoria-final.json'
    $audit.AuditManifestPath = $auditManifestPath

    if ($prior.Status -ne 'INCOMPLETO') { throw "O manifesto anterior tem status inesperado: $($prior.Status)" }
    foreach ($property in $prior.Verified.PSObject.Properties) {
      if ($property.Name -eq 'EmbeddedExecutableEquality') { continue }
      $audit.PreviousChecks[$property.Name] = [bool]$property.Value
      if (-not [bool]$property.Value) { throw "Verificacao anterior ja estava reprovada: $($property.Name)" }
    }
    $audit.Checks.PriorAuditChecksPreserved = ($audit.PreviousChecks.Count -gt 0)
    if (-not $prior.Executable.HashesEqual -or
        $prior.Executable.Sha256BeforeBundle -ne $prior.Executable.Sha256AfterBundle -or
        $prior.Build.ExitCode -ne 0 -or $prior.Nsis.BundleExitCode -ne 0 -or
        -not $prior.PortableExtractionAudit.Extraction.IndependentExtractionCompleted) {
      throw 'Evidencia anterior de build/bundle/extracao independente esta ausente ou divergente.'
    }

    $exePath = [IO.Path]::GetFullPath($prior.Executable.Path)
    $installerPath = [IO.Path]::GetFullPath($prior.Nsis.InstallerPath)
    $nsiPath = [IO.Path]::GetFullPath($prior.Nsis.ScriptPath)
    $capabilityPath = [IO.Path]::GetFullPath($prior.Capabilities.ManifestPath)
    $effectiveConfigPath = [IO.Path]::GetFullPath($prior.Build.EffectiveConfigPath)
    foreach ($artifactPath in @($exePath, $installerPath, $nsiPath, $capabilityPath, $effectiveConfigPath)) {
      if (-not (Test-PathWithinDirectory $artifactPath $existingFull)) { throw "Artefato fora do diretorio de execucao registrado: $artifactPath" }
      if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Artefato registrado ausente: $artifactPath" }
    }
    $normalPath = [IO.Path]::GetFullPath($prior.NormalConfig.Path)
    $expectedNormalPath = [IO.Path]::GetFullPath((Join-Path $Worktree 'src-tauri/tauri.conf.json'))
    if (-not $normalPath.Equals($expectedNormalPath, [StringComparison]::OrdinalIgnoreCase)) {
      throw "O caminho da configuracao normal nao corresponde ao arquivo da homologacao esperado: $normalPath"
    }
    if ((Get-GitValue @('branch', '--show-current') | Select-Object -First 1) -ne $expectedBranch) {
      throw "Worktree incorreto. Esperada branch $expectedBranch."
    }

    $audit.Files.OriginalExecutablePath = $exePath
    $audit.Files.OriginalExecutableLength = (Get-Item -LiteralPath $exePath).Length
    $audit.Files.OriginalExecutableSha256Before = Get-Sha256 $exePath
    $audit.Files.InstallerPath = $installerPath
    $audit.Files.InstallerSha256Before = Get-Sha256 $installerPath
    $audit.Files.NsisScriptPath = $nsiPath
    $audit.Files.NsisScriptSha256Before = Get-Sha256 $nsiPath
    $audit.Files.CompiledCapabilitiesPath = $capabilityPath
    $audit.Files.CompiledCapabilitiesSha256 = Get-Sha256 $capabilityPath
    $audit.Files.EffectiveConfigPath = $effectiveConfigPath
    $audit.Files.EffectiveConfigSha256 = Get-Sha256 $effectiveConfigPath
    $audit.Files.NormalConfigPath = $normalPath
    $audit.Files.NormalConfigSha256Before = Get-Sha256 $normalPath
    $audit.Files.AuditScriptSha256Before = $audit.AuditScriptSha256Before
    if ($audit.Files.NormalConfigSha256Before -ne $prior.NormalConfig.Sha256Before -or
        $audit.Files.NormalConfigSha256Before -ne $prior.NormalConfig.Sha256After) {
      throw 'A configuracao Tauri normal nao corresponde ao hash registrado na auditoria anterior.'
    }

    $hashesMatch = $audit.Files.OriginalExecutableSha256Before -eq $prior.Executable.Sha256BeforeBundle -and
      $audit.Files.InstallerSha256Before -eq $prior.Nsis.InstallerSha256 -and
      $audit.Files.NsisScriptSha256Before -eq $prior.Nsis.ScriptSha256 -and
      $audit.Files.CompiledCapabilitiesSha256 -eq $prior.Capabilities.ManifestSha256 -and
      $audit.Files.EffectiveConfigSha256 -eq $prior.Build.EffectiveConfigSha256
    $audit.Checks.PriorArtifactsMatchRecordedHashes = [bool]$hashesMatch
    if (-not $hashesMatch) { throw 'Hashes atuais de artefatos nao correspondem ao manifesto anterior.' }

    $compiledCapabilities = [IO.File]::ReadAllText($capabilityPath) | ConvertFrom-Json
    $compiledClose = $compiledCapabilities.PSObject.Properties['homologacao-window-close'].Value
    $compiledDefault = $compiledCapabilities.PSObject.Properties['default'].Value
    $compiledPermissions = @($compiledClose.permissions)
    $capCloseOk = $null -ne $compiledClose -and
      @($compiledClose.windows).Count -eq 1 -and @($compiledClose.windows)[0] -eq 'main' -and
      $compiledPermissions.Count -eq 2 -and
      $compiledPermissions -contains 'core:window:allow-close' -and
      $compiledPermissions -contains 'core:window:allow-destroy' -and
      $null -ne $compiledDefault
    $audit.Checks.CapabilityCompiledCorrectly = [bool]$capCloseOk
    $audit.Checks.CapabilityAllowsCloseAndDestroy = [bool]($compiledPermissions.Count -eq 2 -and $compiledPermissions -contains 'core:window:allow-close' -and $compiledPermissions -contains 'core:window:allow-destroy')
    if (-not $capCloseOk) { throw 'Capabilities compiladas nao contem a capability exclusiva esperada para main.' }

    $effectiveConfig = [IO.File]::ReadAllText($effectiveConfigPath) | ConvertFrom-Json
    $configOk = $effectiveConfig.identifier -eq 'com.apamind.homologacao' -and
      ($effectiveConfig.productName -eq 'ApaMind Homologacao' -or $effectiveConfig.productName -eq 'ApaMind Homologação')
    $configOk = $configOk -and $effectiveConfig.version -eq '0.7.1' -and
      (@($effectiveConfig.app.windows | ForEach-Object { $_.label }) -contains 'main') -and
      [bool]$effectiveConfig.app.withGlobalTauri -and
      (@($effectiveConfig.app.security.capabilities) -contains 'default') -and
      (@($effectiveConfig.app.security.capabilities) -contains 'homologacao-window-close')
    $audit.Checks.EffectiveHomologationConfigValid = [bool]$configOk
    if (-not $configOk) { throw 'A configuracao efetiva registrada nao corresponde a homologacao esperada.' }

    $nsiText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($nsiPath))
    $mainBinaryMatch = [regex]::Match($nsiText, '(?im)^\s*!define\s+MAINBINARYSRCPATH\s+"([^"]+)"')
    $mainFileLines = [regex]::Matches($nsiText, '(?im)^\s*File\s+"?\$\{MAINBINARYSRCPATH\}"?\s*$')
    $nsiReferences = $mainBinaryMatch.Success -and
      [IO.Path]::GetFullPath($mainBinaryMatch.Groups[1].Value).Equals($exePath, [StringComparison]::OrdinalIgnoreCase) -and
      $mainFileLines.Count -eq 1
    $audit.Checks.NsisFileDirectiveReferencesOriginalExe = [bool]$nsiReferences
    if (-not $nsiReferences) { throw 'installer.nsi nao referencia exatamente uma vez o executavel original registrado.' }

    $sevenZip = Resolve-SevenZip
    if (-not $sevenZip) { throw '7-Zip nao foi encontrado; extracao NSIS independente nao pode ser feita.' }
    $audit.Extraction.ToolPath = $sevenZip
    $audit.Extraction.ToolSha256 = Get-Sha256 $sevenZip
    $audit.Artifacts['OriginalExecutable'] = [ordered]@{ Path = $exePath; Length = $audit.Files.OriginalExecutableLength; Sha256 = $audit.Files.OriginalExecutableSha256Before }
    $audit.Artifacts['Installer'] = [ordered]@{ Path = $installerPath; Sha256 = $audit.Files.InstallerSha256Before }
    $audit.Artifacts['NsisScript'] = [ordered]@{ Path = $nsiPath; Sha256 = $audit.Files.NsisScriptSha256Before }
    $audit.Artifacts['CompiledCapabilities'] = [ordered]@{ Path = $capabilityPath; Sha256 = $audit.Files.CompiledCapabilitiesSha256 }
    $audit.Artifacts['EffectiveConfig'] = [ordered]@{ Path = $effectiveConfigPath; Sha256 = $audit.Files.EffectiveConfigSha256 }
    $audit.Artifacts['PreviousManifest'] = [ordered]@{ Path = $priorManifestPath; Sha256 = $audit.PreviousManifestSha256 }
    $audit.Artifacts['7Zip'] = [ordered]@{ Path = $sevenZip; Sha256 = $audit.Extraction.ToolSha256 }

    $oldExtractionPath = [IO.Path]::GetFullPath($prior.PortableExtractionAudit.Extraction.ExtractedExecutablePath)
    if (-not (Test-PathWithinDirectory $oldExtractionPath $existingFull) -or -not (Test-Path -LiteralPath $oldExtractionPath -PathType Leaf)) {
      throw "A extracao independente anterior nao esta disponivel dentro do diretorio de auditoria: $oldExtractionPath"
    }
    $audit.Extraction.PreviousExtractionPath = $oldExtractionPath
    $audit.Extraction.PreviousExtractionSha256 = Get-Sha256 $oldExtractionPath
    $audit.Extraction.PreviousExtractionMatches = [bool]($audit.Extraction.PreviousExtractionSha256 -eq $prior.PortableExtractionAudit.Extraction.ExtractedExecutableSha256)
    if (-not $audit.Extraction.PreviousExtractionMatches) { throw 'A extracao NSIS previamente registrada mudou.' }
    $audit.Artifacts['PreviousExtractedPayload'] = [ordered]@{ Path = $oldExtractionPath; Sha256 = $audit.Extraction.PreviousExtractionSha256 }

    $freshExtractDir = Join-Path $auditRoot 'nsis-extraido'
    New-Item -ItemType Directory -Path $freshExtractDir | Out-Null
    $freshExe = Join-Path $freshExtractDir 'apamind-homologacao.exe'
    $stdoutPath = Join-Path $auditRoot '7zip.stdout.log'
    $stderrPath = Join-Path $auditRoot '7zip.stderr.log'
    $audit.Extraction.StdoutPath = $stdoutPath
    $audit.Extraction.StderrPath = $stderrPath
    $quoteArg = { param([string]$Value) '"' + $Value.Replace('"', '\"') + '"' }
    $arguments = 'x -y -o' + (& $quoteArg $freshExtractDir) + ' ' + (& $quoteArg $installerPath) + ' ' + (& $quoteArg 'apamind-homologacao.exe')
    $audit.Extraction.Command = '7z.exe ' + $arguments
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $sevenZip
    $start.Arguments = $arguments
    $start.WorkingDirectory = $auditRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'Nao foi possivel iniciar a extracao independente do payload.' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdoutText = $stdoutTask.GetAwaiter().GetResult()
    $stderrText = $stderrTask.GetAwaiter().GetResult()
    $audit.Extraction.ExitCode = $process.ExitCode
    $process.Dispose()
    [IO.File]::WriteAllText($stdoutPath, $stdoutText, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText($stderrPath, $stderrText, (New-Object Text.UTF8Encoding($false)))
    if ($audit.Extraction.ExitCode -ne 0) { throw "7-Zip falhou ao extrair o payload NSIS ($($audit.Extraction.ExitCode)): $stderrText" }
    if (-not (Test-Path -LiteralPath $freshExe -PathType Leaf)) { throw "A extracao nao produziu o executavel esperado: $freshExe" }
    $audit.Extraction.ExtractedExecutablePath = $freshExe
    $audit.Extraction.ExtractedExecutableSha256 = Get-Sha256 $freshExe
    $audit.Extraction.ExtractedExecutableLength = (Get-Item -LiteralPath $freshExe).Length
    $audit.Checks.ExtractionCompleted = $true
    $audit.Artifacts['FreshExtractedPayload'] = [ordered]@{ Path = $freshExe; Length = $audit.Extraction.ExtractedExecutableLength; Sha256 = $audit.Extraction.ExtractedExecutableSha256 }

    $originalBytes = [IO.File]::ReadAllBytes($exePath)
    $originalMarkerBytes = [Text.Encoding]::ASCII.GetBytes($audit.MarkerTransformation.OriginalMarker)
    $transformedMarkerBytes = [Text.Encoding]::ASCII.GetBytes($audit.MarkerTransformation.TransformedMarker)
    $originalOffsets = @(Get-BytePatternOffsets $originalBytes $originalMarkerBytes)
    $transformedOffsetsOriginal = @(Get-BytePatternOffsets $originalBytes $transformedMarkerBytes)
    $audit.MarkerTransformation.OriginalMarkerCount = $originalOffsets.Count
    $audit.MarkerTransformation.TransformedMarkerCountInOriginal = $transformedOffsetsOriginal.Count
    $audit.Checks.OriginalMarkerCountCorrect = [bool]($originalOffsets.Count -eq 1 -and $transformedOffsetsOriginal.Count -eq 0)
    if (-not $audit.Checks.OriginalMarkerCountCorrect) { throw "Marcador original esperado uma vez e marcador transformado ausente; contagens UNK=$($originalOffsets.Count), NSS=$($transformedOffsetsOriginal.Count)." }
    $markerOffset = [int]$originalOffsets[0]
    $suffixOffset = $markerOffset + $originalMarkerBytes.Length - 3
    $audit.MarkerTransformation.MarkerByteOffset = $markerOffset
    $audit.MarkerTransformation.ReplacementByteOffset = $suffixOffset
    $audit.MarkerTransformation.OriginalSuffixHex = [BitConverter]::ToString($originalBytes[$suffixOffset..($suffixOffset + 2)]).Replace('-', '')
    if ($audit.MarkerTransformation.OriginalSuffixHex -ne '554E4B') { throw 'Os bytes finais do marcador original nao correspondem a UNK.' }

    $patchedPath = Join-Path $auditRoot 'apamind-homologacao-nsis-marker-patched.exe'
    [IO.File]::WriteAllBytes($patchedPath, $originalBytes)
    $patchedBytes = [IO.File]::ReadAllBytes($patchedPath)
    $patchedBytes[$suffixOffset] = 0x4E
    $patchedBytes[$suffixOffset + 1] = 0x53
    $patchedBytes[$suffixOffset + 2] = 0x53
    [IO.File]::WriteAllBytes($patchedPath, $patchedBytes)
    $audit.Files.PatchedCopyPath = $patchedPath
    $audit.Files.PatchedCopySha256 = Get-Sha256 $patchedPath
    $audit.MarkerTransformation.TransformedMarkerCountInPatchedCopy = @(Get-BytePatternOffsets $patchedBytes $transformedMarkerBytes).Count
    $originalVsPatched = Compare-BinaryFiles $exePath $patchedPath
    $audit.Comparisons.OriginalVsPatched = $originalVsPatched
    $audit.MarkerTransformation.DifferenceCountOriginalVsPatched = $originalVsPatched.DifferenceCount
    $audit.MarkerTransformation.DifferenceOffsetsOriginalVsPatched = @($originalVsPatched.Differences | ForEach-Object { $_.Offset })
    $onlyExpectedDifferences = $originalVsPatched.LeftLength -eq $originalVsPatched.RightLength -and
      $originalVsPatched.DifferenceCount -eq 3 -and
      ((@($originalVsPatched.Differences | ForEach-Object { $_.Offset }) -join ',') -ceq (@($suffixOffset, ($suffixOffset + 1), ($suffixOffset + 2)) -join ',')) -and
      (@($originalVsPatched.Differences | ForEach-Object { $_.LeftHex }) -join '') -eq '554E4B' -and
      (@($originalVsPatched.Differences | ForEach-Object { $_.RightHex }) -join '') -eq '4E5353'
    $audit.Checks.OnlyDocumentedThreeBytesChanged = [bool]$onlyExpectedDifferences
    $audit.Checks.PatchedCopyHasExpectedMarker = [bool]($audit.MarkerTransformation.TransformedMarkerCountInPatchedCopy -eq 1)
    if (-not $audit.Checks.PatchedCopyHasExpectedMarker -or -not $audit.Checks.OnlyDocumentedThreeBytesChanged) {
      throw 'A copia temporaria nao contem exclusivamente a transformacao documentada dos tres bytes UNK para NSS.'
    }

    $patchedVsPayload = Compare-BinaryFiles $patchedPath $freshExe
    $audit.Comparisons.PatchedCopyVsNsisPayload = $patchedVsPayload
    $payloadMatches = $patchedVsPayload.LeftLength -eq $patchedVsPayload.RightLength -and $patchedVsPayload.DifferenceCount -eq 0 -and
      $audit.Files.PatchedCopySha256 -eq $audit.Extraction.ExtractedExecutableSha256
    $audit.Checks.ExtractedPayloadMatchesPatchedCopy = [bool]$payloadMatches
    $audit.Checks.ExtractedPayloadMatchesPatchedCopy = [bool]$payloadMatches
    if (-not $payloadMatches) { throw "Payload NSIS possui diferencas alem da substituicao documentada: $($patchedVsPayload.DifferenceCount) bytes divergentes." }

    $audit.Files.OriginalExecutableSha256After = Get-Sha256 $exePath
    $audit.Files.InstallerSha256After = Get-Sha256 $installerPath
    $audit.Files.NsisScriptSha256After = Get-Sha256 $nsiPath
    $audit.Files.NormalConfigSha256After = Get-Sha256 $normalPath
    $audit.Files.AuditScriptSha256After = Get-Sha256 $PSCommandPath
    $audit.Comparisons.OriginalUnchanged = $audit.Files.OriginalExecutableSha256Before -eq $audit.Files.OriginalExecutableSha256After
    $audit.Comparisons.InstallerUnchanged = $audit.Files.InstallerSha256Before -eq $audit.Files.InstallerSha256After
    $audit.Comparisons.NsisScriptUnchanged = $audit.Files.NsisScriptSha256Before -eq $audit.Files.NsisScriptSha256After
    $audit.Comparisons.NormalConfigUnchanged = $audit.Files.NormalConfigSha256Before -eq $audit.Files.NormalConfigSha256After
    $audit.Comparisons.AuditScriptUnchangedDuringAudit = $audit.Files.AuditScriptSha256Before -eq $audit.Files.AuditScriptSha256After
    $audit.Checks.OriginalExecutableUnchanged = $audit.Comparisons.OriginalUnchanged
    $audit.Checks.InstallerUnchanged = $audit.Comparisons.InstallerUnchanged
    $audit.Checks.NsisScriptUnchanged = $audit.Comparisons.NsisScriptUnchanged
    $audit.Checks.NormalConfigUnchanged = $audit.Comparisons.NormalConfigUnchanged
    $audit.Checks.AuditScriptUnchangedDuringAudit = $audit.Comparisons.AuditScriptUnchangedDuringAudit
    if (-not $audit.Checks.OriginalExecutableUnchanged -or -not $audit.Checks.InstallerUnchanged -or
        -not $audit.Checks.NsisScriptUnchanged -or -not $audit.Checks.NormalConfigUnchanged -or
        -not $audit.Checks.AuditScriptUnchangedDuringAudit) {
      throw 'Um dos arquivos de origem ou protecao foi alterado durante a auditoria.'
    }

    $audit.GitAfter = Get-SourceSnapshot
    $gitBeforeJson = $audit.GitBefore | ConvertTo-Json -Depth 100 -Compress
    $gitAfterJson = $audit.GitAfter | ConvertTo-Json -Depth 100 -Compress
    $audit.Checks.GitStateUnchangedDuringAudit = $gitBeforeJson -ceq $gitAfterJson
    if (-not $audit.Checks.GitStateUnchangedDuringAudit) { throw 'O estado Git do worktree mudou durante a auditoria.' }
    $audit.Status = 'APROVADO'
  } catch {
    $audit.Errors += $_.Exception.Message
    $audit.Status = 'REPROVADO'
  } finally {
    if ($auditRoot -and (Test-Path -LiteralPath $auditRoot -PathType Container)) {
      if (-not $audit.GitAfter) {
        try { $audit.GitAfter = Get-SourceSnapshot } catch { $audit.Errors += "Falha ao capturar GitAfter: $($_.Exception.Message)" }
      }
      if ($audit.Files.OriginalExecutablePath -and (Test-Path -LiteralPath $audit.Files.OriginalExecutablePath -PathType Leaf)) {
        try {
          if (-not $audit.Files.OriginalExecutableSha256After) { $audit.Files.OriginalExecutableSha256After = Get-Sha256 $audit.Files.OriginalExecutablePath }
          $audit.Comparisons.OriginalUnchanged = $audit.Files.OriginalExecutableSha256Before -eq $audit.Files.OriginalExecutableSha256After
          $audit.Checks.OriginalExecutableUnchanged = $audit.Comparisons.OriginalUnchanged
        } catch { }
      }
      if (-not $audit.Files.NormalConfigSha256After -and $audit.Files.NormalConfigPath) {
        try { $audit.Files.NormalConfigSha256After = Get-Sha256 $audit.Files.NormalConfigPath } catch { }
      }
      if ($audit.Files.NormalConfigSha256Before -and $audit.Files.NormalConfigSha256After) {
        $audit.Comparisons.NormalConfigUnchanged = $audit.Files.NormalConfigSha256Before -eq $audit.Files.NormalConfigSha256After
        $audit.Checks.NormalConfigUnchanged = $audit.Comparisons.NormalConfigUnchanged
      }
      if (-not $audit.Files.AuditScriptSha256After) {
        try { $audit.Files.AuditScriptSha256After = Get-Sha256 $PSCommandPath } catch { }
      }
      if ($audit.Files.AuditScriptSha256Before -and $audit.Files.AuditScriptSha256After) {
        $audit.Comparisons.AuditScriptUnchangedDuringAudit = $audit.Files.AuditScriptSha256Before -eq $audit.Files.AuditScriptSha256After
        $audit.Checks.AuditScriptUnchangedDuringAudit = $audit.Comparisons.AuditScriptUnchangedDuringAudit
      }
      $audit.FinishedUtc = [DateTime]::UtcNow.ToString('o')
      $json = $audit | ConvertTo-Json -Depth 100
      [IO.File]::WriteAllText($auditManifestPath, $json, (New-Object Text.UTF8Encoding($false)))
    }
  }
  if ($audit.Status -eq 'APROVADO') {
    Write-Output "APROVADO: $auditManifestPath"
    Write-Output "Original SHA-256: $($audit.Files.OriginalExecutableSha256Before)"
    Write-Output "Patched copy SHA-256: $($audit.Files.PatchedCopySha256)"
    Write-Output "NSIS payload SHA-256: $($audit.Extraction.ExtractedExecutableSha256)"
    Write-Output "Installer SHA-256: $($audit.Files.InstallerSha256Before)"
    exit 0
  }
  Write-Output "REPROVADO: $auditManifestPath"
  if ($audit.Errors.Count -gt 0) { Write-Output ($audit.Errors -join [Environment]::NewLine) }
  exit 1
}

if ($AuditExistingArtifacts) {
  Invoke-ExistingArtifactAudit
}

if ((Get-GitValue @('branch', '--show-current') | Select-Object -First 1) -ne $expectedBranch) {
  throw "Worktree incorreto. Esperada branch $expectedBranch."
}
if (-not (Test-Path -LiteralPath (Join-Path $Worktree 'node_modules') -PathType Container)) {
  throw 'node_modules ausente no worktree de origem; o script não instalará dependências.'
}
$resolvedOutputRoot = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\') + '\'
$resolvedWorktreePrefix = $Worktree.TrimEnd('\') + '\'
if ($resolvedOutputRoot.StartsWith($resolvedWorktreePrefix, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\').Equals($Worktree.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputRoot deve ficar fora do worktree.'
}
if (Test-Path -LiteralPath $runRoot) { throw "Pasta de execução já existe; recusa reuso: $runRoot" }

$gitBefore = Get-SourceSnapshot
$normalConfigHashBefore = Get-Sha256 $normalConfigPath
$report = [ordered]@{
  SchemaVersion = 1
  RunId = $runId
  StartedUtc = [DateTime]::UtcNow.ToString('o')
  Worktree = $Worktree
  StagedSource = $stagedRoot
  OutputRoot = $runRoot
  Status = 'REPROVADO'
  GitBefore = $gitBefore
  GitAfter = $null
  SourcePreservation = [ordered]@{ Unchanged = $false; PreexistingFilesCompared = 0 }
  NormalConfig = [ordered]@{ Path = $normalConfigPath; Sha256Before = $normalConfigHashBefore; Sha256After = $null; Unchanged = $false }
  Toolchain = [ordered]@{ TauriCliVersion = $null; RustcVersion = $null; CargoVersion = $null; RustToolchainBin = $null; RustcPath = $null; CargoPath = $null; SevenZipPath = $null; SevenZipAvailable = $false }
  Build = [ordered]@{ Command = $null; ProcessStarted = $false; ExitCode = $null; DurationMilliseconds = $null; Failure = $null; LogPath = $buildLog; StdoutLogPath = $buildStdoutLog; StdoutLogSha256 = $null; StderrLogPath = $buildStderrLog; StderrLogSha256 = $null; EffectiveConfigPath = $effectiveConfigPath; EffectiveConfigSha256 = $null; BaseConfigSha256 = $null; HomologationConfigSha256 = $null; RuntimeOverlaySha256 = $null }
  Capabilities = [ordered]@{ SourcePath = (Join-Path $stagedRoot 'src-tauri/capabilities/homologacao-window-close.json'); SourceSha256 = $null; DefaultSourcePath = (Join-Path $stagedRoot 'src-tauri/capabilities/default.json'); DefaultSourceSha256 = $null; ManifestPath = $null; ManifestSha256 = $null; CandidateCount = 0; Found = $false; DefaultFound = $false; WindowMain = $false; AllowClose = $false; AllowDestroy = $false; Details = $null; DefaultDetails = $null }
  Executable = [ordered]@{ Path = $null; Sha256BeforeBundle = $null; Sha256AfterBundle = $null; HashesEqual = $false; Length = $null }
  Nsis = [ordered]@{ ScriptPath = $null; ScriptSha256 = $null; ScriptReferencesExecutable = $false; BundleCommand = $null; BundleProcessStarted = $false; BundleExitCode = $null; BundleDurationMilliseconds = $null; BundleFailure = $null; LogPath = $bundleLog; StdoutLogPath = $bundleStdoutLog; StdoutLogSha256 = $null; StderrLogPath = $bundleStderrLog; StderrLogSha256 = $null; InstallerPath = $null; InstallerSha256 = $null; InstallerLength = $null; EmbeddedExecutable = [ordered]@{ ExtractionAttempted = $false; Extractor = $null; MemberPath = $null; Sha256 = $null; Length = $null; EqualsBuildExecutable = $false; PayloadPath = $null; PayloadFileSha256 = $null; PayloadFileLength = $null; PatchedCopyPath = $null; PatchedCopySha256 = $null; FileHashMatchesStream = $false; MarkerTransformation = $null } }
  Verified = [ordered]@{ EffectiveConfig = $false; WindowMain = $false; CapabilityFileConfigured = $false; DefaultCapabilityIncluded = $false; CapabilitySourceValid = $false; CompiledDefaultCapability = $false; DefaultCapabilityPreserved = $false; CompiledCapability = $false; AllowDestroy = $false; GlobalTauri = $false; InstallerProduced = $false; PrePostBundleHashEqual = $false; EmbeddedExecutableEquality = $false; SourcePreserved = $false; NormalConfigPreserved = $false; GitStateUnchanged = $false }
  Limitations = @()
}

trap {
  $failureMessage = [string]$_.Exception.Message
  if ($null -ne $report) {
    $report.Limitations += "Falha de auditoria: $failureMessage"
    try {
      $report.GitAfter = Get-SourceSnapshot
      $report.SourcePreservation.PreexistingFilesCompared = $report.GitBefore.FileHashes.Count
      $before = $report.GitBefore | ConvertTo-Json -Depth 100 -Compress
      $after = $report.GitAfter | ConvertTo-Json -Depth 100 -Compress
      $report.SourcePreservation.Unchanged = ($before -ceq $after)
      $report.Verified.SourcePreserved = $report.SourcePreservation.Unchanged
      $report.Verified.GitStateUnchanged = $report.SourcePreservation.Unchanged
    } catch { $report.Limitations += "Não foi possível concluir a comparação de Git: $($_.Exception.Message)" }
    try {
      $report.NormalConfig.Sha256After = Get-Sha256 $normalConfigPath
      $report.NormalConfig.Unchanged = ($report.NormalConfig.Sha256Before -eq $report.NormalConfig.Sha256After)
      $report.Verified.NormalConfigPreserved = $report.NormalConfig.Unchanged
    } catch { }
    $report.Status = 'REPROVADO'
    $report.FinishedUtc = [DateTime]::UtcNow.ToString('o')
    if (Test-Path -LiteralPath $runRoot -PathType Container) {
      try { $report | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 } catch { }
    }
    Restore-ProcessEnvironment
  }
  Write-Output "REPROVADO: $failureMessage"
  if ($null -ne $report -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { Write-Output "Manifesto: $manifestPath" }
  exit 1
}

New-Item -ItemType Directory -Path $runRoot | Out-Null
New-Item -ItemType Directory -Path $frontendDir, $scratchDir | Out-Null
$savedEnvironment = @{
  CARGO_TARGET_DIR = [Environment]::GetEnvironmentVariable('CARGO_TARGET_DIR', 'Process')
  CARGO_NET_OFFLINE = [Environment]::GetEnvironmentVariable('CARGO_NET_OFFLINE', 'Process')
  PATH = [Environment]::GetEnvironmentVariable('PATH', 'Process')
  RUSTC = [Environment]::GetEnvironmentVariable('RUSTC', 'Process')
  APAMIND_HOMOLOGACAO = [Environment]::GetEnvironmentVariable('APAMIND_HOMOLOGACAO', 'Process')
  VITE_APAMIND_HOMOLOGACAO = [Environment]::GetEnvironmentVariable('VITE_APAMIND_HOMOLOGACAO', 'Process')
  TEMP = [Environment]::GetEnvironmentVariable('TEMP', 'Process')
  TMP = [Environment]::GetEnvironmentVariable('TMP', 'Process')
  npm_config_cache = [Environment]::GetEnvironmentVariable('npm_config_cache', 'Process')
}

$sourceNodeModules = Join-Path $Worktree 'node_modules'
$stagedNodeModules = Join-Path $stagedRoot 'node_modules'
Copy-TrackedAndLocalFiles $stagedRoot
Copy-InstalledNodeModules $sourceNodeModules $stagedNodeModules

$stagedCapabilityDirectory = Join-Path $stagedRoot 'src-tauri/capabilities'
$stagedDefaultCapabilityPath = Join-Path $stagedCapabilityDirectory 'default.json'
$stagedHomologationCapabilityPath = $report.Capabilities.SourcePath
$stagedHomologationConfigPath = Join-Path $stagedRoot 'src-tauri/tauri.homologacao.conf.json'
if (-not (Test-Path -LiteralPath $stagedDefaultCapabilityPath -PathType Leaf)) {
  throw "Capability default ausente no staging: $stagedDefaultCapabilityPath"
}
$defaultCapabilitySource = Get-Content -LiteralPath $stagedDefaultCapabilityPath -Raw | ConvertFrom-Json
if ($defaultCapabilitySource.identifier -ne 'default') {
  throw "O arquivo de capability default tem identificador inesperado: $stagedDefaultCapabilityPath"
}
if (-not (Test-Path -LiteralPath $stagedCapabilityDirectory -PathType Container)) {
  throw "Pasta de capabilities ausente no staging: $stagedCapabilityDirectory"
}
$homologationCapabilitySource = [pscustomobject]@{
  '$schema' = '../gen/schemas/desktop-schema.json'
  identifier = 'homologacao-window-close'
  description = 'Permite fechar e destruir somente a janela main da homologacao.'
  windows = @('main')
  permissions = @('core:window:allow-close', 'core:window:allow-destroy')
}
if (Test-Path -LiteralPath $stagedHomologationCapabilityPath -PathType Leaf) {
  $existingCapability = Get-Content -LiteralPath $stagedHomologationCapabilityPath -Raw | ConvertFrom-Json
  $existingPermissions = @($existingCapability.permissions)
  $existingWindows = @($existingCapability.windows)
  if ($existingCapability.identifier -ne 'homologacao-window-close' -or
      $existingWindows.Count -ne 1 -or $existingWindows[0] -ne 'main' -or
      $existingPermissions.Count -ne 2 -or
      $existingPermissions -notcontains 'core:window:allow-close' -or
      $existingPermissions -notcontains 'core:window:allow-destroy') {
    throw "Já existe capability de homologação conflitante no staging: $stagedHomologationCapabilityPath"
  }
} else {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $capabilityJson = $homologationCapabilitySource | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($stagedHomologationCapabilityPath, $capabilityJson, $utf8NoBom)
}
$homologationConfig = [IO.File]::ReadAllText($stagedHomologationConfigPath) | ConvertFrom-Json
if (-not $homologationConfig.app -or -not $homologationConfig.app.security) {
  throw "Config temporária de homologação não possui app.security: $stagedHomologationConfigPath"
}
$homologationConfig.app.security.capabilities = @('default', 'homologacao-window-close')
$homologationConfigJson = $homologationConfig | ConvertTo-Json -Depth 100
[IO.File]::WriteAllText($stagedHomologationConfigPath, $homologationConfigJson, $utf8NoBom)
$report.Capabilities.SourceSha256 = Get-Sha256 $stagedHomologationCapabilityPath
$report.Capabilities.DefaultSourceSha256 = Get-Sha256 $stagedDefaultCapabilityPath

$env:CARGO_TARGET_DIR = $targetDir
$env:CARGO_NET_OFFLINE = 'true'
$env:APAMIND_HOMOLOGACAO = '1'
$env:VITE_APAMIND_HOMOLOGACAO = '1'
$env:TEMP = $scratchDir
$env:TMP = $scratchDir
$env:npm_config_cache = Join-Path $scratchDir 'npm-cache'

$rustToolchainBin = Get-SelectedRustToolchainBin $stagedRoot
$rustcPath = Join-Path $rustToolchainBin 'rustc.exe'
$cargoPath = Join-Path $rustToolchainBin 'cargo.exe'
$env:PATH = $rustToolchainBin + ';' + $env:PATH
$env:RUSTC = $rustcPath

$viteOutputRelativePath = '../frontend'
$frontendRelativePath = '../../frontend'
$tauriConfigDirectory = Join-Path $stagedRoot 'src-tauri'
$beforeBuildCommand = 'npm run build -- --outDir ' + $viteOutputRelativePath
$resolvedViteOutput = [IO.Path]::GetFullPath((Join-Path $stagedRoot $viteOutputRelativePath))
$resolvedFrontendDist = [IO.Path]::GetFullPath((Join-Path $tauriConfigDirectory $frontendRelativePath))
if (-not $resolvedViteOutput.Equals($resolvedFrontendDist, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Vite outDir ($resolvedViteOutput) diverge de frontendDist ($resolvedFrontendDist)."
}
if ($beforeBuildCommand.Contains('"') -or $viteOutputRelativePath.Contains('"') -or $frontendRelativePath.Contains('"')) {
  throw 'beforeBuildCommand contém aspas literais no argumento do Vite.'
}
$runtimeOverlay = [pscustomobject]@{
  build = [pscustomobject]@{
    beforeBuildCommand = $beforeBuildCommand
    frontendDist = $frontendRelativePath
  }
}
$overlayJson = $runtimeOverlay | ConvertTo-Json -Depth 20
$effectiveConfigEncoding = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($overlayPath, $overlayJson, $effectiveConfigEncoding)

$baseJson = [IO.File]::ReadAllText($baseConfigPath, $effectiveConfigEncoding) | ConvertFrom-Json
$homologationJson = [IO.File]::ReadAllText($homologationConfigPath, $effectiveConfigEncoding) | ConvertFrom-Json
$overlayParsed = [IO.File]::ReadAllText($overlayPath, $effectiveConfigEncoding) | ConvertFrom-Json
$effectiveConfig = Merge-JsonPatch (Merge-JsonPatch $baseJson $homologationJson) $overlayParsed
$effectiveJson = $effectiveConfig | ConvertTo-Json -Depth 100
[IO.File]::WriteAllText($effectiveConfigPath, $effectiveJson, $effectiveConfigEncoding)

$report.Build.BaseConfigSha256 = Get-Sha256 $baseConfigPath
$report.Build.HomologationConfigSha256 = Get-Sha256 $homologationConfigPath
$report.Build.RuntimeOverlaySha256 = Get-Sha256 $overlayPath
$report.Build.EffectiveConfigSha256 = Get-Sha256 $effectiveConfigPath
$report.Toolchain.TauriCliVersion = ((& node $cliPath --version 2>&1) | Out-String).Trim()
$report.Toolchain.RustToolchainBin = $rustToolchainBin
$report.Toolchain.RustcPath = $rustcPath
$report.Toolchain.CargoPath = $cargoPath
$report.Toolchain.RustcVersion = Get-ExecutableVersion $rustcPath
$report.Toolchain.CargoVersion = Get-ExecutableVersion $cargoPath
$report.Toolchain.SevenZipPath = Resolve-SevenZip
$report.Toolchain.SevenZipAvailable = [bool]$report.Toolchain.SevenZipPath

$windowLabels = @($effectiveConfig.app.windows | ForEach-Object { $_.label })
$capabilityReferences = @($effectiveConfig.app.security.capabilities | Where-Object { $_ -is [string] })
$sourceCapabilityWindows = @($homologationCapabilitySource.windows)
$sourceCapabilityPermissions = @($homologationCapabilitySource.permissions)
$defaultCapabilityWindows = @($defaultCapabilitySource.windows)
$report.Verified.CapabilityFileConfigured = [bool]($capabilityReferences -contains 'homologacao-window-close')
$report.Verified.DefaultCapabilityIncluded = [bool]($capabilityReferences -contains 'default')
$report.Verified.CapabilitySourceValid = [bool](
  $homologationCapabilitySource.identifier -eq 'homologacao-window-close' -and
  $sourceCapabilityWindows.Count -eq 1 -and $sourceCapabilityWindows[0] -eq 'main' -and
  $sourceCapabilityPermissions.Count -eq 2 -and
      $sourceCapabilityPermissions -contains 'core:window:allow-close' -and
      $sourceCapabilityPermissions -contains 'core:window:allow-destroy' -and
  $defaultCapabilitySource.identifier -eq 'default' -and $defaultCapabilityWindows -contains 'main'
)
$effectiveConfigOkay = $effectiveConfig.identifier -eq 'com.apamind.homologacao' -and
  $effectiveConfig.productName -eq 'ApaMind Homologação' -and $effectiveConfig.version -eq '0.7.1'
$report.Verified.EffectiveConfig = [bool]$effectiveConfigOkay
$report.Verified.WindowMain = [bool]($windowLabels -contains 'main')
$report.Verified.GlobalTauri = [bool]$effectiveConfig.app.withGlobalTauri
if (-not $effectiveConfigOkay -or -not $report.Verified.WindowMain -or
    -not $report.Verified.CapabilityFileConfigured -or -not $report.Verified.DefaultCapabilityIncluded -or
    -not $report.Verified.CapabilitySourceValid -or -not $report.Verified.GlobalTauri) {
  throw 'Configuração efetiva não satisfaz os requisitos de homologação; build abortado antes da compilação.'
}

$configArgs = @('--config', 'src-tauri/tauri.homologacao.conf.json', '--config', $overlayPath)
$report.Build.Command = "node `"$cliPath`" build --no-bundle --verbose $($configArgs -join ' ')"
$buildArgs = @($cliPath, 'build', '--no-bundle', '--verbose') + $configArgs
$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$buildResult = Invoke-CapturedProcess $nodeCommand.Source $buildArgs $stagedRoot $buildLog $buildStdoutLog $buildStderrLog
$report.Build.ProcessStarted = $buildResult.ProcessStarted
$report.Build.ExitCode = $buildResult.ExitCode
$report.Build.DurationMilliseconds = $buildResult.DurationMilliseconds
$report.Build.Failure = $buildResult.Failure
$report.Build.StdoutLogSha256 = Get-Sha256 $buildStdoutLog
$report.Build.StderrLogSha256 = Get-Sha256 $buildStderrLog
if (-not $report.Build.ProcessStarted) { throw "Não foi possível iniciar tauri build: $($report.Build.Failure)" }
if ($report.Build.Failure) { throw "Execução de tauri build foi interrompida ou falhou: $($report.Build.Failure)" }
if ($report.Build.ExitCode -ne 0) { throw "Build Tauri falhou ($($report.Build.ExitCode)); veja $buildLog" }

$exePath = Join-Path $targetDir 'release/apamind-homologacao.exe'
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) { throw "Executável esperado não foi produzido: $exePath" }
$report.Executable.Path = $exePath
$report.Executable.Sha256BeforeBundle = Get-Sha256 $exePath
$report.Executable.Length = (Get-Item -LiteralPath $exePath).Length

$capabilityFiles = @(Get-ChildItem -Path (Join-Path $targetDir 'release/build/*/out/capabilities.json') -File -ErrorAction SilentlyContinue)
$report.Capabilities.CandidateCount = $capabilityFiles.Count
if ($capabilityFiles.Count -ne 1) {
  throw "Esperado exatamente um capabilities.json no target isolado da compilação; encontrados $($capabilityFiles.Count)."
}
$compiledCapability = $null
$compiledDefaultCapability = $null
foreach ($capabilityFile in $capabilityFiles) {
  $parsed = Get-Content -LiteralPath $capabilityFile.FullName -Raw | ConvertFrom-Json
  $defaultEntry = $parsed.PSObject.Properties['default']
  if ($defaultEntry) { $compiledDefaultCapability = $defaultEntry.Value }
  $entry = $parsed.PSObject.Properties['homologacao-window-close']
  if ($entry) {
    $compiledCapability = $entry.Value
    $report.Capabilities.ManifestPath = $capabilityFile.FullName
  }
}
$report.Capabilities.DefaultFound = [bool]$compiledDefaultCapability
if ($compiledDefaultCapability) {
  $report.Capabilities.DefaultDetails = $compiledDefaultCapability
  $sourceDefaultPermissionsJson = ConvertTo-Json -InputObject @($defaultCapabilitySource.permissions) -Depth 100 -Compress
  $compiledDefaultPermissionsJson = ConvertTo-Json -InputObject @($compiledDefaultCapability.permissions) -Depth 100 -Compress
  $compiledDefaultWindows = @($compiledDefaultCapability.windows)
  $report.Verified.CompiledDefaultCapability = [bool](
    $compiledDefaultCapability.identifier -eq 'default' -and
    $compiledDefaultWindows.Count -eq $defaultCapabilityWindows.Count -and
    $compiledDefaultWindows -contains 'main'
  )
  $report.Verified.DefaultCapabilityPreserved = [bool](
    $report.Verified.CompiledDefaultCapability -and
    $sourceDefaultPermissionsJson -ceq $compiledDefaultPermissionsJson
  )
}
if (-not $report.Capabilities.DefaultFound -or -not $report.Verified.DefaultCapabilityPreserved) {
  throw 'Capability default ausente ou permissões divergentes no capabilities.json produzido pelo build atual.'
}
if ($compiledCapability) {
  $report.Capabilities.ManifestSha256 = Get-Sha256 $report.Capabilities.ManifestPath
  $report.Capabilities.Found = $true
  $compiledWindows = @($compiledCapability.windows)
  $compiledPermissions = @($compiledCapability.permissions)
  $report.Capabilities.WindowMain = [bool]($compiledWindows.Count -eq 1 -and $compiledWindows[0] -eq 'main')
  $report.Capabilities.AllowClose = [bool]($compiledPermissions.Count -eq 2 -and $compiledPermissions -contains 'core:window:allow-close')
  $report.Capabilities.AllowDestroy = [bool]($compiledPermissions.Count -eq 2 -and $compiledPermissions -contains 'core:window:allow-destroy')
  $report.Capabilities.Details = $compiledCapability
  $report.Verified.CompiledCapability = $report.Capabilities.WindowMain -and $report.Capabilities.AllowClose -and $report.Capabilities.AllowDestroy
  $report.Verified.AllowDestroy = $report.Capabilities.AllowDestroy
} else {
  throw 'Tauri não gerou uma capability homologacao-window-close no target isolado; bundle abortado.'
}
if (-not $report.Verified.CompiledCapability) { throw 'Capability gerada não concede allow-close e allow-destroy à janela main; bundle abortado.' }

$report.Nsis.BundleCommand = "node `"$cliPath`" bundle --bundles nsis --verbose $($configArgs -join ' ')"
$bundleArgs = @($cliPath, 'bundle', '--bundles', 'nsis', '--verbose') + $configArgs
$bundleResult = Invoke-CapturedProcess $nodeCommand.Source $bundleArgs $stagedRoot $bundleLog $bundleStdoutLog $bundleStderrLog
$report.Nsis.BundleProcessStarted = $bundleResult.ProcessStarted
$report.Nsis.BundleExitCode = $bundleResult.ExitCode
$report.Nsis.BundleDurationMilliseconds = $bundleResult.DurationMilliseconds
$report.Nsis.BundleFailure = $bundleResult.Failure
$report.Nsis.StdoutLogSha256 = Get-Sha256 $bundleStdoutLog
$report.Nsis.StderrLogSha256 = Get-Sha256 $bundleStderrLog
if (-not $report.Nsis.BundleProcessStarted) { throw "Não foi possível iniciar tauri bundle: $($report.Nsis.BundleFailure)" }
if ($report.Nsis.BundleFailure) { throw "Execução de tauri bundle foi interrompida ou falhou: $($report.Nsis.BundleFailure)" }
if ($report.Nsis.BundleExitCode -ne 0) { throw "Bundle NSIS falhou ($($report.Nsis.BundleExitCode)); veja $bundleLog" }

$report.Executable.Sha256AfterBundle = Get-Sha256 $exePath
$report.Executable.HashesEqual = ($report.Executable.Sha256BeforeBundle -eq $report.Executable.Sha256AfterBundle)
$report.Verified.PrePostBundleHashEqual = $report.Executable.HashesEqual
if (-not $report.Executable.HashesEqual) {
  throw 'SHA-256 do executável mudou durante tauri bundle; auditoria reprovada e equivalência não declarada.'
}

$nsiFiles = @(Get-ChildItem -Path (Join-Path $targetDir 'release/nsis/*/installer.nsi') -File -ErrorAction SilentlyContinue)
if ($nsiFiles.Count -eq 0) { $nsiFiles = @(Get-ChildItem -Path (Join-Path $targetDir 'release/nsis/installer.nsi') -File -ErrorAction SilentlyContinue) }
if ($nsiFiles.Count -ne 1) { throw "Esperado um installer.nsi no target isolado; encontrados $($nsiFiles.Count)." }
$nsiText = Get-Content -LiteralPath $nsiFiles[0].FullName -Raw
$mainBinaryMatch = [regex]::Match($nsiText, '(?im)^\s*!define\s+MAINBINARYSRCPATH\s+"([^"]+)"')
$report.Nsis.ScriptPath = $nsiFiles[0].FullName
$report.Nsis.ScriptSha256 = Get-Sha256 $nsiFiles[0].FullName
if ($mainBinaryMatch.Success) {
  $nsiExePath = [IO.Path]::GetFullPath($mainBinaryMatch.Groups[1].Value)
  $report.Nsis.ScriptReferencesExecutable = ($nsiExePath -ieq [IO.Path]::GetFullPath($exePath))
}
if (-not $report.Nsis.ScriptReferencesExecutable) { throw 'installer.nsi não referencia o executável produzido nesta execução.' }

$installerDir = Join-Path $targetDir 'release/bundle/nsis'
$installers = @(Get-ChildItem -LiteralPath $installerDir -File -Filter '*_0.7.1_x64-setup.exe' -ErrorAction SilentlyContinue)
if ($installers.Count -ne 1) { throw "Esperado um instalador NSIS x64 0.7.1; encontrados $($installers.Count) em $installerDir." }
$installer = $installers[0]
$report.Nsis.InstallerPath = $installer.FullName
$report.Nsis.InstallerSha256 = Get-Sha256 $installer.FullName
$report.Nsis.InstallerLength = $installer.Length
$report.Verified.InstallerProduced = $true

if ($report.Toolchain.SevenZipAvailable) {
  $report.Nsis.EmbeddedExecutable.ExtractionAttempted = $true
  $report.Nsis.EmbeddedExecutable.Extractor = $report.Toolchain.SevenZipPath
  $embedded = Get-EmbeddedExecutableHash $report.Toolchain.SevenZipPath $installer.FullName
  $report.Nsis.EmbeddedExecutable.MemberPath = $embedded.MemberPath
  $report.Nsis.EmbeddedExecutable.Sha256 = $embedded.Sha256
  $report.Nsis.EmbeddedExecutable.Length = $embedded.Length
  $report.Nsis.EmbeddedExecutable.EqualsBuildExecutable = ($embedded.Sha256 -eq $report.Executable.Sha256BeforeBundle)
  $extractDirectory = Join-Path $scratchDir 'nsis-marker-extraction'
  $payload = Extract-EmbeddedExecutableToFile $report.Toolchain.SevenZipPath $installer.FullName $embedded.MemberPath $extractDirectory
  $report.Nsis.EmbeddedExecutable.PayloadPath = $payload.Path
  $report.Nsis.EmbeddedExecutable.PayloadFileSha256 = Get-Sha256 $payload.Path
  $report.Nsis.EmbeddedExecutable.PayloadFileLength = (Get-Item -LiteralPath $payload.Path).Length
  $report.Nsis.EmbeddedExecutable.FileHashMatchesStream = [bool](
    $report.Nsis.EmbeddedExecutable.PayloadFileSha256 -eq $embedded.Sha256 -and
    $report.Nsis.EmbeddedExecutable.PayloadFileLength -eq $embedded.Length
  )
  if (-not $report.Nsis.EmbeddedExecutable.FileHashMatchesStream) { throw 'A extracao em arquivo diverge da extracao independente em fluxo do NSIS.' }
  $patchedCopyPath = Join-Path $scratchDir 'apamind-homologacao-nsis-marker-patched.exe'
  $markerAudit = Test-ExpectedTauriBundleMarkerTransform $exePath $payload.Path $patchedCopyPath
  $report.Nsis.EmbeddedExecutable.PatchedCopyPath = $patchedCopyPath
  $report.Nsis.EmbeddedExecutable.PatchedCopySha256 = $markerAudit.PatchedCopySha256
  $report.Nsis.EmbeddedExecutable.MarkerTransformation = $markerAudit
  $report.Verified.EmbeddedExecutableEquality = [bool](
    $report.Nsis.EmbeddedExecutable.FileHashMatchesStream -and
    $markerAudit.OriginalUnchanged -and
    $markerAudit.OnlyDocumentedThreeBytesChanged -and
    $markerAudit.PayloadMatchesPatchedCopy
  )
  if (-not $report.Verified.EmbeddedExecutableEquality) {
    throw 'Hash do executável extraído do NSIS difere do executável produzido por tauri build; auditoria reprovada.'
  }
} else {
  $report.Limitations += 'Extração independente não realizada: 7-Zip não está disponível. A equivalência do executável dentro do NSIS não foi comprovada.'
}

$report.GitAfter = Get-SourceSnapshot
$report.SourcePreservation.PreexistingFilesCompared = $report.GitBefore.FileHashes.Count
$beforeSnapshotJson = $report.GitBefore | ConvertTo-Json -Depth 100 -Compress
$afterSnapshotJson = $report.GitAfter | ConvertTo-Json -Depth 100 -Compress
$report.SourcePreservation.Unchanged = ($beforeSnapshotJson -ceq $afterSnapshotJson)
$report.Verified.SourcePreserved = $report.SourcePreservation.Unchanged
$report.Verified.GitStateUnchanged = $report.SourcePreservation.Unchanged
if (-not $report.SourcePreservation.Unchanged) { throw 'O estado ou conteúdo versionável do worktree de origem mudou; auditoria reprovada.' }

$normalConfigHashAfter = Get-Sha256 $normalConfigPath
$report.NormalConfig.Sha256After = $normalConfigHashAfter
$report.NormalConfig.Unchanged = ($normalConfigHashBefore -eq $normalConfigHashAfter)
$report.Verified.NormalConfigPreserved = $report.NormalConfig.Unchanged
if (-not $report.NormalConfig.Unchanged) { throw 'A configuração normal mudou; auditoria reprovada.' }

$report.FinishedUtc = [DateTime]::UtcNow.ToString('o')
$requiredChecks = @($report.Verified.Values)
if ($requiredChecks -contains $false) {
  $failedChecks = @($requiredChecks | Where-Object { $_ -eq $false })
  if (-not $report.Verified.EmbeddedExecutableEquality -and -not $report.Toolchain.SevenZipAvailable -and $failedChecks.Count -eq 1) {
    $report.Status = 'INCOMPLETO'
  } else {
    throw 'Uma ou mais verificações obrigatórias falharam; auditoria reprovada.'
  }
} else {
  $report.Status = 'APROVADO'
}
$report | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Restore-ProcessEnvironment
Write-Output "$($report.Status): $manifestPath"
Write-Output "Installer SHA-256: $($report.Nsis.InstallerSha256)"
Write-Output "Manifest SHA-256: $(Get-Sha256 $manifestPath)"
if ($report.Status -eq 'INCOMPLETO') {
  Write-Output 'Equivalência do executável dentro do NSIS não foi comprovada; extração independente não foi realizada.'
  exit 2
}
