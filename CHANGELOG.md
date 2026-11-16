# Changelog

## 0.7.3 — 2026-11-16

Correção do empacotamento Windows. Sem mudança de código, de formato persistido ou de comportamento
do aplicativo: os dados de 0.7.2 são lidos normalmente.

### Instalador

- **Correção:** o MSI não substituía a versão anterior. O template WiX do Tauri 2.11 declara
  `AllowDowngrades="yes"` e a tabela `Upgrade` gerada marca a versão anterior apenas como detectada
  (`OnlyDetect`). Sem versão a remover, o `RemoveExistingProducts` não fazia nada e a instalação nova
  se registrava como um segundo produto na mesma pasta — duas entradas (`0.7.1` e `0.7.2`) apontando
  para `C:\Program Files\APAMIND`, com o `apamind.exe` já na versão nova.
- O bundle Windows passa a ser **somente NSIS**, definido em `src-tauri/tauri.windows.conf.json`
  (configuração por plataforma) com `installMode: currentUser`: instala em `%LOCALAPPDATA%\APAMIND`,
  sem exigir administrador. O NSIS detecta a instalação MSI anterior e a desinstala antes de instalar —
  nesse caso é preciso executar o instalador **como administrador**, porque o MSI é por máquina e o
  NSIS pede nível `user`; sem elevação o `msiexec` falha com erro 1601. Entre versões NSIS, oferece
  desinstalar antes (padrão) ou reinstalar por cima. Nos dois casos resta **uma única** entrada em
  Aplicativos instalados.
- `README.md`, `INSTALL_CHECKLIST.md` e `docs/CONTEXTO_DO_PROJETO.md` documentam o fluxo de
  instalação/atualização e o motivo de o MSI ter sido descontinuado.

## 0.7.2 — 2026-11-15

Consolidação de repositório, arquitetura, recuperação de dados, links e qualidade.
Sem mudança no formato persistido que exija ação do usuário: os dados de 0.7.1 são
lidos normalmente.

### Repositório e build

- Histórico reiniciado a partir da linha publicada (decisão consciente): um único
  commit raiz, sem os artefatos de build que inflavam o `.git` para ~969 MB.
- Caches e arquivos gerados (`.tmp/`, `.vs/`, `src-tauri/gen/`) deixaram de ser
  versionados; o `.gitignore` passou a cobrir `.tmp/` inteiro, `*.bundle` e
  `*.tsbuildinfo`.
- `.gitattributes` fixa a normalização de fim de linha (texto em LF, scripts
  Windows em CRLF), eliminando diffs fantasma.
- `npm run build` passou a usar `vite-build.cjs`, que redireciona `TEMP`/`TMP` para
  `.tmp/vite-build-temp` (o esbuild falhava ao limpar temporários na pasta padrão).
- Ferramental de homologação movido para `tools/homologacao/`; logs de build
  removidos; Prettier aplicado a todo o `src` e passou a ser portão de CI.
- CI em GitHub Actions: typecheck, lint, formatação, testes, build e
  `npm audit --omit=dev`. Build desktop roda sob demanda (`cargo check`).

### Arquitetura

- `src/mind.ts` e `src/io.ts` foram desmontados em `src/core/` (domínio puro),
  `src/storage/` (workspace, recuperação, importação e exportação) e `src/ui/theme.ts`.
- Teste de arquitetura impede que `core/` importe `storage`/`ui`/APIs do host e que
  `storage/` importe `ui`; também falha se os antigos arquivos únicos reaparecerem.
- Contrato do formato documentado em `docs/contracts/workspace.schema.json`.

### Recuperação de dados

- A carga agora **valida a integridade estrutural** (nó sem id/título/posição, ids
  duplicados, arestas órfãs, anexos malformados) e recusa dados inválidos
  preservando o arquivo.
- Arquivo criado por versão **mais recente** é recusado (`WorkspaceFutureVersionError`)
  em vez de ter o `schemaVersion` rebaixado em silêncio.
- Divergência entre `workspace.json` e a cópia local deixou de bloquear o aplicativo:
  abre o `RecoveryDialog`, onde o usuário pode usar o arquivo, usar a cópia local
  (o arquivo é preservado em `workspace.json.tmp-recovery-*` antes de ser
  substituído), exportar as duas cópias brutas ou sair sem alterar.

### Links e anexos

- **Correção crítica:** ao restaurar um Backup Total, referências internas
  `map://<id>` eram perdidas porque os mapas recebem ids novos na importação. Agora
  são remapeadas.
- Referências internas quebradas ficam visíveis na barra superior.
- Campo legado `links[]` descontinuado: convertido para anexos do tipo `url` na
  carga e na importação (apenas `http(s)`, sem duplicar destinos).
- Anexo repetido no mesmo nó é recusado; excluir um mapa referenciado pede
  confirmação informando quantos links ficarão quebrados.
- Links em notas Markdown não navegam mais o WebView: o clique é delegado ao mesmo
  caminho validado dos anexos (Opener do Tauri), restrito a `http(s)`.
- Detecção de extensões bloqueadas endurecida contra convenções do Windows
  (`arquivo.exe.`, `arquivo.exe::$DATA`).

### Interface

- Atalhos de teclado passaram a usar o estado atual: `Ctrl+Z`/`Ctrl+Shift+Z`,
  `Ctrl+C/V/D`, `Ctrl+N`, `Ctrl+A` e `Esc` funcionavam sobre o estado do primeiro
  render (ou não funcionavam).
- Exclusão de mapa sempre pede confirmação, com o título e o aviso de referências.
- `ErrorBoundary` global substitui a tela em branco em caso de exceção de render.
- Animações de modal migraram de `framer-motion` para CSS, respeitando
  `prefers-reduced-motion`.
- Dependências de produção reduzidas de 8 para 5 (`clsx`, `tailwind-merge` e
  `framer-motion` removidos; os dois primeiros só serviam a um helper não utilizado).
- CSP endurecida com `base-uri`, `object-src`, `frame-ancestors` e `form-action`.

### Testes

- Novos testes: referências internas, remapeamento em backup, migração de `links`,
  integridade na carga, versão futura, resolução de fontes no boot e um teste de
  componente com Testing Library cobrindo o fluxo `Ctrl+A` → `Delete` → `Ctrl+Z`.
