# Build rastreável da homologação 0.7.1

Este procedimento compila somente a branch temporária `temp/homologacao-apamind`. Ele não instala nem inicia o ApaMind. A saída de cada execução fica em um diretório novo sob `%LOCALAPPDATA%\Temp\ApaMind-Homologacao-Rastreavel-<id>`; o diretório nunca é reutilizado e não há rotina de limpeza automática.

## Preparação

No PowerShell, execute o script a partir do worktree temporário:

```powershell
$worktree = 'C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  (Join-Path $worktree 'tools/homologacao/compilar-homologacao-rastreavel.ps1')
```

`ExecutionPolicy Bypass` vale apenas para esse processo PowerShell; o script não altera a política global. O script exige a branch temporária esperada, verifica os arquivos de configuração e recusa reutilizar um diretório de execução.

## Etapas executadas pelo script

1. Registra branch, commit e `git status --porcelain` antes do build.
2. Cria um ID único e define `CARGO_TARGET_DIR`, `TEMP`, `TMP` e a saída do Vite dentro do diretório temporário exclusivo. O Vite recebe `--outDir` para não reutilizar ou atualizar `dist` no worktree.
3. Gera um overlay temporário de build e combina a configuração base, `tauri.homologacao.conf.json` e esse overlay segundo JSON Merge Patch. Salva e calcula o hash da configuração efetiva.
4. Confere antes de compilar: identificador `com.apamind.homologacao`, produto `ApaMind Homologação`, versão `0.7.1`, janela `main`, `withGlobalTauri: true` e capability inline `homologacao-window-close` com `core:window:allow-close` aplicada a `main`. Se algum valor divergir, aborta antes do build.
5. Executa `tauri build --no-bundle --config ...` e grava `build.log`. O target exclusivo começa vazio, evitando artefatos de builds anteriores.
6. Localiza o executável produzido e o `capabilities.json` no `out` do build Rust. Registra os hashes e valida no manifesto gerado que a capability está associada a `main` e inclui `core:window:allow-close`. Se não encontrar essa capability gerada, aborta antes do bundle.
7. Executa `tauri bundle --bundles nsis --config ...` com as mesmas configurações e grava `bundle.log`. Registra o `.nsi` gerado, valida que `MAINBINARYSRCPATH` aponta ao executável desta execução e calcula o hash do instalador.
8. Se encontrar um 7-Zip já instalado, lista o conteúdo NSIS e calcula o SHA-256 do executável interno por fluxo, sem gravá-lo ou executá-lo. Só marca equivalência quando esse hash coincide com o hash do executável de origem após o bundle. Não instala ferramentas.
9. Registra Git depois do processo e compara o hash de `src-tauri/tauri.conf.json` antes/depois. Produz `manifesto-auditoria.json` e imprime seu hash.

## Cadeia de evidências

O manifesto liga os arquivos pelo ID único da execução e pelos hashes: configurações base, de homologação, overlay temporário e configuração efetiva; `capabilities.json`; executável antes e depois do bundle; `.nsi`; logs; instalador; e, quando houver extração independente, o executável interno do NSIS.

O status `FULLY_VERIFIED` exige que a extração independente do executável interno tenha ocorrido e seu hash seja igual ao hash do executável da mesma compilação. Sem extrator, o pacote pode ser gerado e o `.nsi` documenta o caminho-fonte usado, mas o manifesto declara a equivalência interna como não comprovada e usa `BUILT_WITH_TRACEABLE_PROVENANCE_BUT_INCOMPLETE_EMBEDDED_CHECK`.

Falhas de validação interrompem o processo; o manifesto não deve ser interpretado como prova de etapas que não foram concluídas. Os logs e os artefatos temporários são preservados para inspeção manual. O script não remove arquivos.

## Arquivos de saída

No diretório da execução:

- `cargo-target\release\apamind-homologacao.exe`
- `cargo-target\release\build\apamind-*\out\capabilities.json`
- `cargo-target\release\nsis\*\installer.nsi`
- `cargo-target\release\bundle\nsis\*_0.7.1_x64-setup.exe`
- `build.log`, `bundle.log`, `tauri-config-efetiva.json` e `manifesto-auditoria.json`

O script não instala, inicia, limpa ou desinstala aplicativos e não acessa os diretórios de dados do ApaMind.
