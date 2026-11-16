# Contexto do projeto ApaMind

Atualizado em 2026-11-01. Este documento resume decisões aprovadas e o estado observado no repositório; não substitui os testes nem autoriza mudanças fora do escopo combinado.

## Objetivo e funcionalidades

ApaMind é um editor local de mapas mentais para desktop e web. Inclui canvas de nós e conexões, múltiplos mapas e templates, layouts, notas/Markdown, checklists, links, anexos, importação e exportação. O aplicativo desktop usa Tauri e persiste os dados localmente; não depende de um serviço remoto para o workspace.

## Arquitetura e arquivos principais

- `src/App.tsx`: interface React, canvas, edição, anexos/links, estados de gravação e fluxo de fechamento.
- `src/mind.ts`: tipos do workspace, templates e layouts, migração/validação v5/v6, recuperação e persistência.
- `src/io.ts`: importação/exportação de mapas e workspaces.
- `src/closeGuard.ts`: guarda de fechamento desktop, espera da fila de gravação e retry após falha.
- `src/attachmentSecurity.ts`: classificação/validação de URLs e caminhos locais, incluindo normalização HTTPS de domínios sem protocolo.
- `src/attachmentActions.ts`: abertura de links, anexos locais e referências a outros mapas, usando validação de `attachmentSecurity.ts` e o Opener oficial no desktop.
- `src/mapOperations.ts` e `src/mapHistory.ts`: operações puras de edição/relacionamento dos mapas e snapshots de desfazer/refazer.
- `src/backgrounds.ts`: presets, padrões de fundo e conversões de cor.
- `src/components/AppControls.tsx`: controles reutilizáveis e diálogo de erro ao salvar/fechar.
- `src-tauri/src/lib.rs`: inicializa os plugins Rust Tauri FS, Opener e logging.
- `src-tauri/tauri.conf.json`: configuração do app, CSP, janela e comandos de desenvolvimento/build.
- `src-tauri/capabilities/default.json`: permissões IPC, escopos do Opener e do filesystem.
- `vite.config.ts`: build frontend; servidor de desenvolvimento vinculado a `127.0.0.1`.
- `src/*.test.ts`, `src/persistence.integration.test.ts`: testes unitários e integrados de persistência, encerramento, anexos e permissões.

Tecnologias: React 19, TypeScript 5.9, Vite 7, Vitest 4, Tauri 2/Rust. Plugins Tauri usados: `plugin-fs`, `plugin-opener` e logging. As dependências e scripts estão em `package.json`; compilação Rust e dependências nativas em `src-tauri/Cargo.toml`.

## Decisões técnicas aprovadas

### Dados e persistência (Fase 1)

- No desktop, `workspace.json` em AppLocalData é a fonte principal. `localStorage` mantém cópia de recuperação e não pode substituir silenciosamente um arquivo principal mais recente ou divergente.
- Recuperação/migração trata v5, v6 e arquivo principal sem descartar cópias originais nem escolher automaticamente entre fontes divergentes. Dados inválidos/divergentes devem ser preservados; se há dados irrecuperáveis, não se inicializa um workspace vazio.
- Gravações são enfileiradas sequencialmente. A escrita usa temporário, releitura/validação, rename e validação final; erros chegam à interface com estados de salvamento.
- O encerramento desktop cancela debounce, espera a fila e só fecha após gravação confirmada. Falha mantém o app aberto e oferece retry/cancelamento. A web continua usando o comportamento web.
- Não alterar a lógica de persistência aprovada sem necessidade de segurança demonstrada.

### Segurança e links (Fase 2)

- Vite deve permanecer local (`127.0.0.1`); não reintroduzir `0.0.0.0` nem `allowedHosts: true` sem necessidade explícita.
- A capability não concede permissões recursivas genéricas do filesystem. FS fica limitado às operações e aos caminhos de `workspace.json` e `workspace.json.tmp-*` em AppLocalData.
- Opener tem escopos explícitos `http://*` e `https://*`, sem restrição de domínio. Caminhos locais abertos por Opener estão limitados às pastas padrão do usuário configuradas em `default.json`.
- Links externos válidos HTTP(S) abrem em ação explícita do usuário via Tauri Opener, sem confirmação extra. Validação rejeita outros esquemas, URLs malformadas e credenciais embutidas. Endereços reconhecíveis sem esquema são normalizados para HTTPS ao criar; links existentes continuam no mesmo campo/formato.
- Anexos locais são classificados separadamente e continuam usando `openPath`; `file://` é tratado como caminho local, não como URL externa. Caminhos UNC, relativos, com navegação `..` e tipos locais executáveis/atalhos são rejeitados.
- Não adicionar shell/processos externos para abrir links ou arquivos.

## Fases concluídas e validação

- **Fase 1A — recuperação/migração segura:** aprovada. Cópias v5/v6/workspace preservadas e fontes divergentes não escolhidas silenciosamente.
- **Fase 1B — persistência confiável:** aprovada. Workspace principal, espelho de recuperação, fila sequencial, escrita verificada e erros/estados de UI.
- **Fase 1C — encerramento seguro:** aprovada. Fechamento aguarda saves, erro oferece retry/cancelamento e testes cobrem falhas e gravações pendentes.
- **Fase 1D — validação final:** aprovada. Um backup adicional fora do projeto foi comparado por hash com o original; dados reais não foram usados em testes. O caminho informado para a cópia externa é `%LOCALAPPDATA%\ApaMind-Safety-Backups\phase1A-20261101`. Sua criação e integridade foram confirmadas anteriormente; sua existência atual não foi revalidada.
- **Fase 2 — segurança:** aprovada. A revisão específica confirmou a preservação de links HTTP(S), sem lista de domínios, mantendo escopos Tauri explícitos e validação de URLs/caminhos.
- **Fase 3 — qualidade e confiabilidade:** implementação concluída nesta sessão. Corrigido o remapeamento de conexões ao colar seleção após mudança de seleção; operações de mapas/nós/conexões foram isoladas em helpers testáveis, incluindo limpeza de conexões e IDs recolhidos ao excluir nós. Importadores agora rejeitam XML inválido/sem raiz e arquivos XMind sem tópicos, validam relações e anexos, mantêm metadados de mapa e exibem falhas sem adicionar mapas ao workspace. JSON e backup ganharam serializadores testáveis para roundtrip de links, anexos, notas, checklists e conexões.
- **Fase 4 — organização e manutenibilidade:** aprovada e implementada sem alterar comportamento ou persistência. `App.tsx` delega o histórico de undo/redo a `mapHistory.ts`; abertura de links/anexos/mapas a `attachmentActions.ts`; presets e helpers de cor a `backgrounds.ts`; controles, seletor de emoji e diálogo de falha a `components/AppControls.tsx`. Import/export continuam concentrados em `io.ts`; persistência/encerramento continuam em `mind.ts` e `closeGuard.ts`. O arquivo principal foi reduzido em aproximadamente 14 KB e 360 linhas.

Após a Fase 3: `npm.cmd test -- --reporter=dot` — 98 testes aprovados em 7 arquivos; `npm.cmd run typecheck` — aprovado; `git diff --check` — aprovado; build de produção em `.tmp/phase1c-esbuild-temp-final` — aprovado; `cargo check --offline -j 1` — aprovado. ESLint passou nos cinco arquivos de código/teste alterados; `npm.cmd run lint` completo continua falhando por cinco avisos `prefer-const` preexistentes em `src/closeGuard.test.ts` e `src/mind.ts`, não relacionados aos arquivos da Fase 3. O build ainda emite aviso não bloqueante de depreciação de `module.register()` do Node.

Após a Fase 4: `npm.cmd test -- --reporter=dot --silent` — 108 testes aprovados em 9 arquivos; `npm.cmd run typecheck`, `npm.cmd run lint` e `git diff --check` — aprovados; build de produção usando `.tmp/phase1c-esbuild-temp-final` — aprovado; `cargo check --offline -j 1` — aprovado. Os cinco avisos `prefer-const` foram corrigidos. O build continua emitindo aviso não bloqueante de depreciação de `module.register()` do Node.

- **Fase 5 — padronização, otimização e preparação para distribuição:** implementação aprovada e consolidada em `f237708`. Alinhadas as versões declaradas do app em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` para `0.7.1`; definido `private: true` e engines Node `^20.19.0 || >=22.12.0`; removida a dependência direta não utilizada `cross-env`. Atualizados seletivamente DOMPurify para `3.4.17`, Vite para `7.3.7` e Vitest/@vitest/ui para `4.1.12`, com lockfiles sincronizados; Cargo lock atualizado para Tauri `2.12.5` (requisito mínimo `2.11.6`) e dependências compatíveis. O bundle inicialmente detectou diferença entre `@tauri-apps/plugin-fs` (`2.5.1`) e o crate Rust (`2.7.1`); a dependência npm foi alinhada para `2.7.1` e os bundles MSI/NSIS passaram a ser gerados. A atualização corrige advisories conhecidos de DOMPurify, Vite, Vitest e Tauri, sem atualização geral de dependências.
- A configuração Tauri agora lista os ícones PNG, ICNS e ICO existentes para os alvos de bundle. `README.md` e `INSTALL_CHECKLIST.md` foram substituídos por instruções atuais de instalação de desenvolvimento, testes, build web/desktop, requisitos Windows e pendências de distribuição; removidas orientações antigas de instalação manual do CLI/Opener e permissões amplas.
- Validação Fase 5: `npm.cmd test -- --reporter=dot --silent` — 108 testes aprovados em 9 arquivos; typecheck, lint, `git diff --check`, build de produção, `cargo check --offline -j 1` e `npm.cmd run tauri:build` — aprovados. Foram gerados MSI `APAMIND_0.7.1_x64_pt-BR.msi` (~3.59 MB) e NSIS `APAMIND_0.7.1_x64-setup.exe` (~2.42 MB), ambos sem assinatura Authenticode. Build web: JS principal `478.42 kB` (`146.76 kB` gzip), CSS `62.46 kB` (`9.80 kB` gzip), mais chunks menores; permanece aviso Node `DEP0205` (`module.register()`). O build Tauri emite aviso da variável `STATIC_VCRUNTIME` deprecada, herdada do ambiente; `build.cjs` do projeto não a define. `npm audit --omit=dev` encontrou zero vulnerabilidades; auditoria completa reportou 14 apenas em dependências de desenvolvimento (1 baixa, 13 moderadas; nenhuma alta/crítica).

## Problemas conhecidos e pendências

- A importação de Markdown é deliberadamente baseada em outline e não preserva metadados específicos (links, anexos, estilos e checklists); roundtrip sem perda é coberto pelo formato JSON/backup. Não foi executado teste manual de abertura de link/anexo em uma janela desktop nesta sessão.
- Abertura de arquivos locais fora das pastas permitidas pela capability (Documentos, Downloads, Desktop, Imagens, Vídeos e Áudio) é bloqueada. Caminhos de rede também são bloqueados.
- A integração do Opener é validada por testes de código/configuração e `cargo check`; falta teste manual de ponta a ponta em desktop que confirme navegador padrão e comportamento do instalador em cada sistema operacional.
- Os instaladores locais MSI/NSIS foram gerados, mas não instalados/testados em máquina limpa. A distribuição pública requer certificado de assinatura de código Windows, além da decisão de canal de atualização/distribuição. Não foi executado teste manual em desktop que confirme instalador, links e anexos de ponta a ponta.
- Auditoria npm: permanecem advisories moderados/baixos em ferramentas de desenvolvimento, principalmente cadeia ESLint/minimatch, e um aviso baixo em esbuild; foram deixados sem override/atualização incompatível. Reavaliar quando houver releases compatíveis. A auditoria de dependências Rust não foi executada porque `cargo audit` não está instalado; não instalar ferramenta adicional nesta fase sem justificativa.
- O relatório de segredos anterior não encontrou credenciais embutidas no código revisado; repetir a busca se forem adicionados serviços externos ou configuração de credenciais.

## Backups existentes e finalidade

Inventário somente por nomes, estrutura e metadados; nenhum conteúdo de backup foi aberto ou alterado durante esta atualização.

- `C:\Users\-\Desktop\DESENVOLVIMENTO\ApaMind\.tmp\phase1a-data-backup-20261101\`: cópia bruta de proteção da Fase 1A. Contém `workspace.json` e a pasta `local-storage-leveldb` com os 11 arquivos LevelDB. Está dentro do projeto, mas é ignorada pelo Git. Preservar como cópia original de recuperação.
- `C:\Users\-\Desktop\DESENVOLVIMENTO\03_Guardados\BACKUP_DEV\apamind_backup_2026-10-30_2026.json`: exportação JSON de backup do ApaMind, fora do projeto ativo, datada de 30/10/2026. Manter como cópia exportada; não foi comparada por hash nesta sessão.
- `C:\Users\-\Desktop\ApaMind_BKP\`: snapshot/cópia antiga do projeto (inclui repositório e `apamind-updated.zip`), não identificado como cópia dos dados reais do workspace.
- **Cópia extra externa da Fase 1D:** `%LOCALAPPDATA%\ApaMind-Safety-Backups\phase1A-20261101`. Sua criação e integridade foram confirmadas anteriormente; a existência atual não foi verificada nesta sessão. Não criar outra cópia nem mover arquivos sem solicitação.

Os backups de dados preservam mapas/estado do aplicativo; anexos locais são armazenados como caminhos, não como cópias dos arquivos referenciados. Não usar nenhum desses backups em experimentos.

## Problemas de ambiente já identificados

- Em execução restrita, Vitest/esbuild pode falhar com `Access is denied` ao tentar resolver diretórios ancestrais. `npm.cmd test` passou quando executado no contexto autorizado fora desse limite.
- Builds de produção anteriores falharam ao criar arquivos temporários na pasta temporária padrão. A build passou com `TEMP` e `TMP` direcionados a `.tmp/phase1c-esbuild-temp-final`; usar essa pasta isolada sem limpá-la indiscriminadamente.
- `cargo check` dentro do sandbox teve problemas ao iniciar processos filhos de Rust; `cargo check --offline -j 1` passou fora desse limite.
- Git já recusou criar `.git/index.lock` em operação de restauração no sandbox. Não executar restaurações/reset sem conferir cuidadosamente o alvo e as permissões.
- Node emite aviso não bloqueante de depreciação de `module.register()`. Git também pode avisar sobre conversão LF/CRLF nos arquivos modificados.

## Estado do Git observado

Commits de referência:

- `635ee50` — `chore: checkpoint approved data protection and security phases` (Fases 1 e 2).
- `d42a0b4` — `feat: improve map operations and import validation` (Fase 3; seis arquivos aprovados, sem backups/dados/temporários).
- `0308872` — `docs: record phase 3 commit reference` (documentação do hash da Fase 3).
- `f237708` — `chore: prepare app for Windows distribution` (Fase 5).

Antes da consolidação da Fase 4, o working tree estava limpo em `0308872`; o conjunto da Fase 4 foi consolidado posteriormente. A Fase 5 começou com o Git limpo em `448dc58`; os 13 arquivos da fase foram consolidados em `f237708`. A atualização deste documento com o hash é a única alteração pendente para o segundo commit documental. Os artefatos de distribuição e `src-tauri/target/` são outputs locais ignorados pelo Git. Nenhum dado real ou backup foi usado ou modificado.

## Regras para próximas sessões

1. Não abrir, usar em experimentos, substituir ou apagar dados reais do workspace ou backups. Usar fixtures isoladas nos testes.
2. Preservar todas as cópias de dados; não escolher automaticamente entre versões divergentes nem sobrescrever dados inválidos antes de preservá-los.
3. Manter compatibilidade com os formatos e decisões aprovados na Fase 1; não refatorar persistência sem necessidade concreta.
4. Manter o servidor de desenvolvimento acessível apenas localmente e as permissões Tauri no menor escopo funcional.
5. Links HTTP(S) não devem ganhar uma whitelist de domínios nem confirmação por abertura. Continuar rejeitando esquemas externos não autorizados e credenciais embutidas.
6. Não usar shell para abertura de URL/arquivo; preservar a separação entre link externo e anexo local.
7. Não instalar dependências sem justificativa; executar os testes/typecheck/build e verificações Rust pertinentes às mudanças.
8. Conferir alterações pré-existentes no Git antes de editar ou restaurar arquivos e preservar o trabalho não consolidado.
