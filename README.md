# ApaMind 0.7.2

Editor local de mapas mentais para Windows, macOS e Linux. O workspace fica no armazenamento
local do aplicativo; links HTTP(S) abrem no navegador padrão e anexos locais são abertos pelo
sistema dentro dos escopos de segurança configurados. Nada depende de serviço remoto.

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

O `package-lock.json` fixa as dependências. Não instale o Tauri CLI nem o plugin Opener
manualmente: eles já estão declarados/configurados no projeto.

## Desenvolvimento local

Frontend no browser:

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
npm.cmd test          # vitest (jsdom)
npm.cmd run typecheck # tsc --noEmit
npm.cmd run lint      # eslint, zero avisos
npm.cmd run format:check
npm.cmd run build
npm.cmd run ci        # typecheck + lint + format + test + build
```

A suíte cobre persistência/recuperação, segurança de anexos, importação/exportação, operações de
mapa, referências entre mapas e um teste de componente do fluxo de atalhos. O CI
(`.github/workflows/ci.yml`) repete esses portões em push e pull request, e ainda roda
`npm audit --omit=dev`. O build desktop roda sob demanda em `.github/workflows/desktop.yml`
(`cargo check` no Windows).

## Build web e instaladores

```powershell
npm.cmd run build      # resultado em dist/
npm.cmd run tauri:build
```

`npm run build` chama `vite-build.cjs`, que redireciona `TEMP`/`TMP` para `.tmp/vite-build-temp`:
neste ambiente o esbuild falha ao remover temporários na pasta padrão do Windows. Para o pacote
desktop, os MSI/NSIS saem em `src-tauri\target\release\bundle\`. O primeiro build Rust pode levar
vários minutos.

A configuração do app está em `src-tauri/tauri.conf.json`: nome `APAMIND`, versão `0.7.2`,
identificador `com.apamind.desktop`. Os instaladores são artefatos locais; este repositório não
publica nem distribui o aplicativo.

## Arquitetura

```
src/
├── core/       domínio puro: modelo, templates, layout, geometria, validação, referências
├── storage/    workspace (fila de gravação), recuperação, import/ e export/
├── ui/         tokens visuais (paletas, formas)
├── components/ AppControls, RecoveryDialog, ErrorBoundary
└── App.tsx     interface: canvas, inspetor, modais, atalhos
```

- `src/core/` não importa `storage`, `ui` nem APIs do host — há um teste de arquitetura garantindo isso.
- O contrato do arquivo de workspace está em `docs/contracts/workspace.schema.json`.
- `src-tauri/src/lib.rs` inicializa os plugins Rust (FS, Opener, log) e o portão de fechamento;
  `src-tauri/capabilities/default.json` define o menor escopo de permissões.

## Funcionalidades

- Mapas, nós, conexões, templates, layouts, desfazer/refazer, notas, Markdown e checklists.
- Links HTTP(S), anexos e referências a outros mapas.
- Importação: JSON, Markdown, FreeMind, XMind e OPML.
- Exportação: JSON, Markdown, SVG, PNG, HTML e impressão.
- Temas, fundos, busca, sidebar e minimapa.

Para intercambiar mapas com todas as informações, use JSON ou Backup Total. Markdown é um formato
de outline e não conserva todos os metadados. Anexos locais são armazenados como caminhos; os
arquivos referenciados não são incluídos no backup.

## Recuperação de dados

- No desktop, `workspace.json` em AppLocalData é a fonte principal; o `localStorage` mantém uma
  cópia de recuperação.
- Se as duas cópias divergirem, o aplicativo **não escolhe sozinho**: abre o diálogo de recuperação
  com as opções usar o arquivo, usar a cópia local (preservando antes o arquivo atual em
  `workspace.json.tmp-recovery-*`), exportar as duas cópias brutas ou sair sem alterar.
- A carga valida a integridade estrutural e recusa arquivos inválidos ou criados por versão mais
  recente, sempre sem alterar o conteúdo.
- Gravações usam temporário, releitura/validação e `rename`.

## Segurança e dados

- Links externos aceitam apenas HTTP/HTTPS e usam o Opener oficial do Tauri; outros esquemas são
  rejeitados. Links de notas passam pelo mesmo caminho validado.
- A abertura de arquivos continua limitada pelas permissões Tauri e validações de caminho.
  Não adicione `opener:default`, curingas de filesystem ou comandos shell para contornar bloqueios.
- A CSP restringe `default-src`, `base-uri`, `object-src`, `frame-ancestors` e `form-action`.
- Antes de desinstalar, reinstalar ou mover o workspace, exporte um Backup Total para fora do
  projeto e preserve os arquivos referenciados por anexos.

## Limitações conhecidas

- Markdown é formato de outline: não preserva links, anexos, estilos nem checklists no roundtrip.
- Anexos são referências de caminho; mover/renomear o arquivo quebra o anexo (o mapa continua íntegro).
- As exportações usam o download do WebView, sem diálogo nativo de "salvar como".
- A impressão gera um documento próprio; vale conferir manualmente no desktop.
- Testes manuais pendentes em desktop: links e anexos de ponta a ponta e instalador em máquina limpa.
- `withGlobalTauri` segue habilitado conscientemente (necessário ao fluxo de fechamento); migrar para
  imports de `@tauri-apps/api` exige validar o fechamento protegido em execução desktop.

## Distribuição

A configuração de bundle está pronta para gerar instaladores, mas a distribuição pública ainda
requer certificado de assinatura de código para Windows e decisão sobre canal de
atualização/distribuição. Builds locais não são assinados. Teste o instalador em máquina limpa
antes de disponibilizá-lo.
