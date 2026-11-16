# Contexto do projeto ApaMind

Atualizado em 2026-11-16, release **0.7.3**. Este documento resume a arquitetura vigente, as
decisões aprovadas e o estado observado no repositório. Não substitui os testes nem autoriza
mudanças fora do escopo combinado.

## Objetivo

Editor local de mapas mentais para desktop (Tauri) e web. Inclui canvas de nós e conexões, múltiplos
mapas e templates, layouts, notas/Markdown, checklists, links, anexos, importação e exportação. Os
dados ficam no armazenamento local do aplicativo; não há serviço remoto.

## Arquitetura atual

```
src/
├── core/          model, templates, layout, geometry, validation, references  (puro)
├── storage/       workspace, recovery, import/, export/                        (I/O)
├── ui/            theme (paletas, formas, classes)
├── components/    AppControls, RecoveryDialog, ErrorBoundary
└── App.tsx        interface (canvas, inspetor, modais, atalhos)
```

- Regra de dependência: `ui → storage → core`. `core/` não importa `storage`, `ui`, `@tauri-apps`,
  `window`, `localStorage` nem `document`; `storage/` não importa `ui`. Isso é verificado por
  `src/architecture.test.ts` — não é convenção, é teste.
- Contrato do arquivo de workspace: `docs/contracts/workspace.schema.json` (referência; o validador
  executável é `core/validation.ts` + `storage/recovery.ts`).
- Rust: `src-tauri/src/lib.rs` só inicializa plugins (FS, Opener, log) e o portão de fechamento;
  a lógica vive no frontend.

## Decisões vigentes

### Dados e persistência

- No desktop, `workspace.json` em AppLocalData é a fonte principal; `localStorage` mantém cópia de
  recuperação e nunca sobrescreve o arquivo.
- Gravações são enfileiradas; cada escrita usa temporário, releitura/validação, `rename` e validação
  final (`storage/workspace.ts`).
- O encerramento desktop cancela o debounce, espera a fila e só fecha após gravação confirmada;
  falha mantém o app aberto com retry/cancelamento (`closeGuard.ts` + portão nativo).

### Recuperação (decisão alterada na 0.7.2)

- **Antes:** divergência entre arquivo e cópia local bloqueava o boot em uma tela sem saída.
- **Agora:** `resolveBootWorkspace()` lê as duas fontes sem alterar nada e devolve
  `ready`/`empty`/`conflict`. No conflito a interface abre o `RecoveryDialog`, que oferece usar o
  arquivo, usar a cópia local (preservando antes o arquivo em `workspace.json.tmp-recovery-*`),
  exportar as duas cópias brutas ou sair sem alterar.
- A carga valida integridade estrutural (`validateWorkspaceIntegrity`) e recusa dados inválidos
  preservando o arquivo.
- `schemaVersion` maior que a suportada é recusado (`WorkspaceFutureVersionError`), nunca rebaixado.

### Links e anexos

- Um único caminho de abertura: `attachmentActions.openAttachment` → `attachmentSecurity` →
  Opener do Tauri. Links de nota Markdown são interceptados e delegados a esse caminho; não existe
  mais `<a target="_blank">` navegável.
- Referências internas usam `map://<id>`; ao importar backup os ids são remapeados
  (`core/references.ts`). Órfãs ficam visíveis na barra superior.
- Campo legado `links[]` foi descontinuado: migra para anexos `url` na carga e na importação.
- Extensões bloqueadas normalizam convenções do Windows (ponto final, espaço final, `::$DATA`,
  percent-encoding).
- Anexo duplicado no nó é recusado; excluir mapa referenciado pede confirmação com a contagem.

### Segurança

- Capability com escopo mínimo: FS restrito a `workspace.json` e `workspace.json.tmp-*`; Opener com
  `http://*`/`https://*` e pastas padrão do usuário. Sem shell, sem processos externos.
- CSP: `default-src 'self'`, `base-uri 'none'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `form-action 'none'`, `script-src 'self'`.
- `withGlobalTauri` permanece habilitado conscientemente: a migração para `@tauri-apps/api` exige
  validar o fechamento protegido em execução desktop real.

### Interface

- Atalhos de teclado: listener estável + handler em ref, sempre com o estado do render atual.
- `react-hooks/exhaustive-deps` está ativo (warn + `--max-warnings=0`).
- `ErrorBoundary` global; animações de modal em CSS com `prefers-reduced-motion`.
- Exclusão de mapa sempre confirma.

### Repositório

- Histórico reiniciado a partir da linha publicada (0.7.1): sem artefatos de build no `.git`.
- `.gitattributes` fixa LF para texto e CRLF para scripts Windows.
- Caches/gerados fora do versionamento (`.tmp/`, `.vs/`, `src-tauri/gen/`).
- Prettier aplicado e exigido no CI; `npm run build` redireciona `TEMP`/`TMP` para `.tmp/`.

### Empacotamento (decisão nova na 0.7.3)

- O bundle Windows é **somente NSIS**, com `installMode: currentUser`: instala em
  `%LOCALAPPDATA%\APAMIND` sem pedir administrador. O MSI deixou de ser gerado.
- Motivo verificado na máquina: a 0.7.2 instalada via MSI sobre a 0.7.1 deixou **duas** entradas
  (`APAMIND 0.7.1` e `APAMIND 0.7.2`) apontando para `C:\Program Files\APAMIND`, com o executável já
  na versão nova. O template WiX do Tauri 2.11 gera `<MajorUpgrade AllowDowngrades="yes">`, cuja linha
  em `Upgrade` fica com `OnlyDetect` (atributo 257): `RemoveExistingProducts` não tem alvo e a
  instalação se registra como um segundo produto.
- Fluxo do NSIS: detecta instalação WiX/MSI por `DisplayName`+`Publisher` nas chaves de desinstalação
  e a remove antes de instalar; entre versões NSIS oferece desinstalar antes (padrão) ou reinstalar por
  cima. Sempre resta uma única entrada. Como o MSI é por máquina e o NSIS pede nível `user`, a
  migração MSI→NSIS exige executar o instalador **como administrador**; sem elevação o `msiexec`
  falha com erro 1601 (verificado na migração 0.7.2 → 0.7.3).
- Alternativa descartada: manter MSI com template WiX próprio exigiria uma cópia do template no
  repositório, sujeita a divergir a cada atualização do Tauri. O NSIS resolve upgrade com o template
  oficial.

## O que foi feito nesta consolidação (sem hashes — o histórico foi reiniciado)

| Fase | Entrega |
| --- | --- |
| A–B | Base consolidada, faxina de repositório, `.gitattributes`, caches fora do git |
| B5 | `mind.ts`/`io.ts` desmontados em `core/` + `storage/`; teste de arquitetura; contrato |
| C | Histórico novo (`main`), branch antiga preservada no remoto até a limpeza |
| D | Remap de `map://`, órfãos visíveis, `links[]` removido, dedupe, confirmação de exclusão |
| E | Validação na carga, versão futura recusada, `RecoveryDialog` |
| F | Atalhos corrigidos, exit boundary, CSS animations, links de nota pelo Opener, RTL |
| G | CSP endurecida, extensões normalizadas, Prettier, CI, auditoria de dependências |
| H | Versão 0.7.2, CHANGELOG, documentação atualizada |
| I | 0.7.3: bundle Windows somente NSIS (`currentUser`), MSI descontinuado |

## Pendências conhecidas

- **Limpeza remota da Fase C: concluída** — `master`, `release/0.7.1` e `temp/homologacao-apamind`
  apagados, `v0.7.1` repontada para a linha consolidada e `git gc` aplicado (`.git` de ~917 MB para
  ~4 MB). Resta opcionalmente apagar a branch remota `ci/fluxo-por-pr`, já mesclada.
- **Migração MSI → NSIS: validada** na máquina de desenvolvimento — o instalador 0.7.3 (executado como
  administrador) removeu o MSI 0.7.2, apagou `C:\Program Files\APAMIND` e deixou uma única entrada
  `APAMIND 0.7.3` em `%LOCALAPPDATA%\APAMIND`, com `workspace.json` intacto.
- Instalador sem assinatura de código: sem certificado, o SmartScreen avisa "editor desconhecido".
- Testes manuais em desktop: links/anexos de ponta a ponta, impressão e instalador em máquina limpa.
- Exportações usam download do WebView (sem diálogo nativo de salvar).
- Migração de `withGlobalTauri` para imports de `@tauri-apps/api`.
- `cargo audit` não executado (ferramenta não instalada).
- Advisories de desenvolvimento (cadeia ESLint/esbuild) permanecem; reavaliar em releases compatíveis.

## Backups e dados reais

- `.tmp/phase1a-data-backup-20261101/` — cópia bruta da Fase 1A (`workspace.json` + LevelDB).
  Ignorada pelo Git; preservar, não usar em experimentos.
- `%LOCALAPPDATA%\ApaMind-Safety-Backups\phase1A-20261101` — cópia externa confirmada anteriormente;
  existência atual não verificada.
- Backups de dados guardam mapas/estado; anexos são caminhos, não cópias.

## Regras para próximas sessões

1. Não abrir, substituir ou apagar dados reais nem backups; usar fixtures nos testes.
2. Preservar todas as cópias; nunca escolher automaticamente entre versões divergentes.
3. Manter as fronteiras `core`/`storage`/`ui` (o teste de arquitetura falha se quebrarem).
4. Não afrouxar permissões Tauri, CSP ou validações de URL/caminho.
5. Rodar `typecheck`, `lint`, `format:check`, `test` e `build` antes de consolidar; commits por assunto,
   com formatação em commit isolado.
6. Conferir `git status` antes de editar ou restaurar; preservar trabalho não consolidado.
