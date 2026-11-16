# ApaMind Homologação 0.7.1 — instalação e reversão

Esta homologação foi preparada somente para este Windows. Ela usa o identificador `com.apamind.homologacao` e não importa nem procura dados ou backups do ApaMind normal (`com.apamind.desktop`). O primeiro início cria um mapa vazio no armazenamento exclusivo da homologação.

## Instalar e testar

1. Execute `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1\ApaMind-Homologacao-0.7.1-x64-setup.exe`.
2. O NSIS instala somente para o usuário atual em `C:\Users\-\AppData\Local\ApaMind Homologação`. O atalho do Menu Iniciar fica em `C:\Users\-\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\ApaMind Homologação\ApaMind Homologação.lnk`; o atalho da Área de Trabalho, quando criado pelo instalador, fica em `C:\Users\-\Desktop\ApaMind Homologação.lnk`.
3. Confirme o nome **ApaMind Homologação** na janela e na lista de aplicativos instalados. Crie e salve conteúdo de teste. Não use arquivos reais nem importe backups.

## Locais exclusivos de dados

Os diretórios abaixo são derivados do identificador Tauri `com.apamind.homologacao` e não coincidem com os do app normal. O instalador não foi executado nesta tarefa; os diretórios de instalação e dados serão criados quando você instalar e iniciar a homologação.

- Workspace e persistência Tauri (`workspace.json`): `C:\Users\-\AppData\Local\com.apamind.homologacao`
- Configurações e dados Tauri: `C:\Users\-\AppData\Roaming\com.apamind.homologacao`
- Dados WebView2, incluindo localStorage, cookies e cache: `C:\Users\-\AppData\Local\com.apamind.homologacao\webview2`
- Raiz do cache local Tauri no Windows: `C:\Users\-\AppData\Local\com.apamind.homologacao` (esta versão não chama a API Tauri de cache; o cache ativo do WebView2 fica no diretório WebView2 acima)
- Logs: `C:\Users\-\AppData\Local\com.apamind.homologacao\logs`
- Instalação: `C:\Users\-\AppData\Local\ApaMind Homologação`
- Registro de desinstalação por usuário: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ApaMind Homologação`
- Atalho do Menu Iniciar: `C:\Users\-\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\ApaMind Homologação\ApaMind Homologação.lnk`
- Atalho da Área de Trabalho: `C:\Users\-\Desktop\ApaMind Homologação.lnk`
- Instalador e temporários de build: `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1`
- Worktree Git temporário: `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree`
- Dependências copiadas para validação isolada: `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree\node_modules`
- Frontend de produção compilado: `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree\dist`
- Binários, bundle e saídas Rust/Tauri: `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree\src-tauri\target`
- Schemas gerados pelo Tauri: `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree\src-tauri\gen`
- Branch Git temporária: `temp/homologacao-apamind`

O logger da build de homologação grava somente no diretório de logs acima. O log de release do app normal não é ativado nem redirecionado por esta configuração.

## Reversão manual

1. Feche ApaMind Homologação.
2. Em **Configurações > Aplicativos > Aplicativos instalados** (ou **Aplicativos e recursos**), escolha **ApaMind Homologação > Desinstalar**. Se o desinstalador perguntar se deseja excluir os dados do app, deixe a caixa desmarcada para revisar e remover os diretórios na etapa seguinte.
3. Depois da desinstalação, remova somente estes diretórios exclusivos se ainda existirem:
   - `C:\Users\-\AppData\Local\ApaMind Homologação` (instalação residual)
   - `C:\Users\-\AppData\Local\com.apamind.homologacao` (workspace, persistência, cache, logs e o perfil WebView2 em `webview2`)
   - `C:\Users\-\AppData\Roaming\com.apamind.homologacao` (configurações e dados Tauri)
4. Remova se ainda existirem o atalho `C:\Users\-\Desktop\ApaMind Homologação.lnk` e a pasta/atalho `C:\Users\-\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\ApaMind Homologação`.
5. Exclua `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1` (instalador e scratch de build).
6. Remova o worktree `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree` e depois a branch `temp/homologacao-apamind`. O script opcional `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree\limpar-homologacao.ps1` mostra os alvos, exige a frase explícita `REMOVER HOMOLOGACAO` e só prossegue depois que a entrada de desinstalação não existir. Para executá-lo sem mudar a política global do PowerShell, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-worktree\limpar-homologacao.ps1"`.
7. Confirme no repositório original `C:\Users\-\Desktop\DESENVOLVIMENTO\ApaMind` que `git status --short --branch` permanece limpo e que `git rev-parse HEAD` continua em `0d307410d89134710723985518acc3dda3b749a7`. A versão normal continua com identificador `com.apamind.desktop` e nome/configuração originais.

O desinstalador pode remover atalhos e registro automaticamente. Revise a lista de aplicativos para confirmar que a entrada **ApaMind Homologação** desapareceu. Não remova entradas de `APAMIND`/`com.apamind.desktop`.

## Artefatos das builds corrigidas

Esta etapa gerou também estes diretórios temporários dedicados; após revisar seu conteúdo, remova-os junto com os artefatos da homologação:

- `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-0.7.1-label-main` — instalador atualizado da homologação e scratch/overlay do build.
- `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-Diagnostico-0.7.1` — primeira build diagnóstica.
- `C:\Users\-\AppData\Local\Temp\ApaMind-Homologacao-Diagnostico-0.7.1-label-main` — instalador diagnóstico corrigido e target Rust usado pelas builds corrigidas.

Se a variante diagnóstica tiver sido instalada, desinstale **ApaMind Homologação Diagnóstico** pelo Windows antes da limpeza. O script opcional agora verifica também a chave de desinstalação diagnóstica e inclui somente os diretórios exatos de dados, atalhos e builds das duas variantes temporárias. Ele continua sem permitir caminhos associados a `com.apamind.desktop`.