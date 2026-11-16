# ApaMind 0.7.3

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

## Fluxo de mudanças

A branch `main` é protegida por ruleset: exige o check `typecheck, lint, format, test, build` e
bloqueia force push e exclusão. Não há push direto — toda mudança entra por pull request:

```powershell
git switch -c fix/algum-ajuste
# ... altera, testa, commita ...
git push -u origin fix/algum-ajuste
# abre o PR; quando o CI ficar verde, faça o merge (squash recomendado)
git switch main
git pull
```

O template de PR (`.github/pull_request_template.md`) lembra os itens de validação. Se o CI
quebrar por problema de ambiente, o ruleset pode ser editado em `Settings → Rules` — não é
necessário bypass permanente.

## Build web e instaladores

```powershell
npm.cmd run build      # resultado em dist/
npm.cmd run tauri:build
```

`npm run build` chama `vite-build.cjs`, que redireciona `TEMP`/`TMP` para `.tmp/vite-build-temp`:
neste ambiente o esbuild falha ao remover temporários na pasta padrão do Windows. Para o pacote
desktop, o instalador sai em `src-tauri\target\release\bundle\nsis\`. O primeiro build Rust pode
levar vários minutos.

A configuração do app está em `src-tauri/tauri.conf.json`: nome `APAMIND`, versão `0.7.3`,
identificador `com.apamind.desktop`. O direcionamento do bundle Windows fica em
`src-tauri/tauri.windows.conf.json` (somente `nsis`, com `installMode: currentUser`), usando a
configuração por plataforma do Tauri. Os instaladores são artefatos locais; este repositório não
publica nem distribui o aplicativo.

## Instalação e atualização

O pacote é um único `.exe` NSIS, **por usuário** (não pede administrador) e instala em
`%LOCALAPPDATA%\APAMIND`. Os dados do workspace ficam em `%LOCALAPPDATA%\com.apamind.desktop` e não
são removidos ao desinstalar.

- **0.7.3 sobre uma instalação MSI anterior:** o NSIS detecta a instalação WiX/MSI e sempre a
  desinstala antes de instalar. Como o MSI é por máquina (`C:\Program Files`), execute **o instalador
  como administrador** nesse primeiro caso (botão direito → Executar como administrador). Rodando como
  usuário comum, o Windows Installer responde com o erro 1601 — "O serviço Windows Installer não pôde
  ser acessado". Comportamento confirmado na migração da 0.7.2 para a 0.7.3.
- **NSIS sobre NSIS:** o instalador detecta a versão anterior e oferece "desinstalar antes de
  instalar" (padrão) ou reinstalar por cima. Nos dois casos fica **uma única** entrada em Aplicativos
  instalados.
- **MSI descontinuado:** o template WiX do Tauri 2.11 declara `AllowDowngrades="yes"`, e a tabela
  `Upgrade` do MSI marca a versão anterior somente como detectada (`OnlyDetect`). O
  `RemoveExistingProducts` fica sem nada a remover e a versão nova se registra como **segundo
  produto** na mesma pasta — foi o que produziu duas entradas (0.7.1 e 0.7.2) apontando para
  `C:\Program Files\APAMIND`. Decisão registrada em `docs/CONTEXTO_DO_PROJETO.md`.

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

O bundle configurado é o instalador NSIS por usuário, ainda **não assinado**. A distribuição pública
segue pendente de certificado de assinatura de código para Windows (sem ele o SmartScreen avisa
"editor desconhecido") e de decisão sobre canal de atualização. Teste o instalador em máquina limpa
antes de disponibilizá-lo.
