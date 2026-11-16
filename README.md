# ApaMind 0.7.1

Editor local de mapas mentais para Windows, macOS e Linux. O workspace fica no armazenamento local do aplicativo; links HTTP(S) abrem no navegador padrão e anexos locais são abertos pelo sistema dentro dos escopos de segurança configurados.

## Requisitos

- Node.js `^20.19.0` ou `>=22.12.0`.
- Rust stable e, no Windows, toolchain MSVC.
- Visual Studio 2022 Build Tools com a carga **Desenvolvimento para desktop com C++** e Windows SDK.
- WebView2 Runtime no Windows.

## Instalação para desenvolvimento

No PowerShell, na raiz do repositório:

```powershell
npm.cmd ci
```

O `package-lock.json` fixa as dependências. Não instale o Tauri CLI nem o plugin Opener manualmente: eles já estão declarados/configurados no projeto.

## Desenvolvimento local

Frontend no browser de desenvolvimento:

```powershell
npm.cmd run dev
```

O Vite escuta apenas em `127.0.0.1:5173`.

Aplicativo desktop com hot reload:

```powershell
npm.cmd run tauri:dev
```

## Testes e validação

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
git diff --check
cargo check --offline -j 1
```

Build web de produção:

```powershell
npm.cmd run build
```

O resultado fica em `dist/`. O script chama `vite-build.cjs`, que redireciona `TEMP`/`TMP` para
`.tmp/vite-build-temp`: neste ambiente o esbuild falha ao remover temporários na pasta padrão do
Windows (`Access is denied`).

## Gerar instaladores desktop

Para compilar e empacotar na plataforma atual:

```powershell
npm.cmd run tauri:build
```

No Windows, o Tauri gera os instaladores MSI e NSIS em `src-tauri\target\release\bundle\msi\` e `src-tauri\target\release\bundle\nsis\`. O script `build.cjs` direciona `TEMP` e `TMP` para `.tmp/` no projeto porque algumas ferramentas de build falham no temporário padrão deste ambiente. O primeiro build Rust pode levar vários minutos.

A configuração do app está em `src-tauri\tauri.conf.json`: nome `APAMIND`, versão `0.7.1`, identificador `com.apamind.desktop` e ícones em `src-tauri\icons\`. O bundle inclui configurações para Windows Installer (WiX/MSI) e NSIS. Os arquivos instaladores só são artefatos locais; este repositório não publica nem distribui o aplicativo.

## Funcionalidades

- Mapas, nós, conexões, templates, layouts, desfazer/refazer, notas, Markdown e checklists.
- Links HTTP(S), anexos e referências a outros mapas.
- Importação: JSON, Markdown, FreeMind, XMind e OPML.
- Exportação: JSON, Markdown, SVG, PNG, HTML e impressão.
- Temas, fundos, busca, sidebar e minimapa.

Para intercambiar mapas com todas as informações, use JSON ou Backup Total. Markdown é um formato de outline e não conserva todos os metadados. Anexos locais são armazenados como caminhos; os arquivos referenciados não são incluídos no backup.

## Segurança e dados

- Links externos aceitam HTTP e HTTPS e usam o Opener oficial do Tauri; outros esquemas são rejeitados.
- A abertura de arquivos continua limitada pelas permissões Tauri e validações de caminho do projeto. Não adicione `opener:default`, curingas de filesystem ou comandos shell para contornar bloqueios.
- Antes de desinstalar, reinstalar ou mover o workspace, exporte um Backup Total JSON para uma pasta segura fora do projeto. Preserve também os arquivos locais referenciados por anexos.

## Distribuição

A configuração de bundle está preparada para gerar instaladores, mas a distribuição pública ainda requer um certificado de assinatura de código para Windows e decisão sobre canal de atualização/distribuição. Builds locais não são assinados por este projeto. Teste o instalador em uma máquina limpa antes de disponibilizá-lo.