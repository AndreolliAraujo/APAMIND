# Build diagnóstica de inicialização — ApaMind Homologação 0.7.1

Esta variante existe somente para capturar erros de inicialização. Ela não substitui o instalador anterior e usa identificador, instalação e armazenamento próprios.

## Build

No PowerShell, a partir do worktree, execute:

```powershell
.\tools\homologacao\build-diagnostico.ps1
```

O script recusa sobrescrever uma pasta de saída existente. O instalador, os temporários de build e o target Rust ficam em:

`%TEMP%\ApaMind-Homologacao-Diagnostico-0.7.1\`

Instalador esperado: `ApaMind-Homologacao-Diagnostico-0.7.1-x64-setup.exe`.

## Teste e captura

1. Instale o pacote diagnóstico pelo NSIS. O produto aparece como **ApaMind Homologação Diagnóstico**, separado da homologação 0.7.1 e do ApaMind normal.
2. Inicie pelo atalho **ApaMind Homologação Diagnóstico**. Não é necessário iniciar por console.
3. Se ocorrer panic ou erro retornado na inicialização do Tauri, leia:

   `%TEMP%\ApaMind-Homologacao-Diagnostico-0.7.1\startup-diagnostic.log`

   O arquivo registra um marcador de entrada, a mensagem do panic e um backtrace Rust. A gravação usa apenas a biblioteca padrão Rust e não depende do plugin Tauri de log. Se não houver arquivo, confirme que `%TEMP%` está acessível e registre esse resultado; isso indica falha ainda mais inicial ou falha de escrita.

Identidade e diretórios próprios:

- Identificador Tauri: `com.apamind.homologacao.diagnostico`
- Instalação NSIS: `%LOCALAPPDATA%\ApaMind Homologação Diagnóstico`
- Dados locais/workspace/cache/logs: `%LOCALAPPDATA%\com.apamind.homologacao.diagnostico`
- Configuração Tauri: `%APPDATA%\com.apamind.homologacao.diagnostico`
- Perfil WebView2: `%LOCALAPPDATA%\com.apamind.homologacao.diagnostico\webview2`
- Captura independente: `%TEMP%\ApaMind-Homologacao-Diagnostico-0.7.1\startup-diagnostic.log`
- Atalho Menu Iniciar: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\ApaMind Homologação Diagnóstico`
- Atalho Área de Trabalho, se selecionado: `%USERPROFILE%\Desktop\ApaMind Homologação Diagnóstico.lnk`

O NSIS está configurado para ignorar instalação do WebView2 e depende do Evergreen já presente. Não importe dados nem backups de nenhuma outra instalação.

## Reversão desta etapa

Após concluir o diagnóstico:

1. Desinstale **ApaMind Homologação Diagnóstico** em Configurações do Windows > Aplicativos > Aplicativos instalados.
2. Feche o aplicativo. Remova, se ainda existirem, somente os diretórios abaixo, após confirmar que o nome completo contém `Homologação Diagnóstico` ou o identificador `com.apamind.homologacao.diagnostico`:
   - `%LOCALAPPDATA%\ApaMind Homologação Diagnóstico`
   - `%LOCALAPPDATA%\com.apamind.homologacao.diagnostico`
   - `%APPDATA%\com.apamind.homologacao.diagnostico`
   - `%APPDATA%\Microsoft\Windows\Start Menu\Programs\ApaMind Homologação Diagnóstico`
   - `%USERPROFILE%\Desktop\ApaMind Homologação Diagnóstico.lnk`
3. Apague `%TEMP%\ApaMind-Homologacao-Diagnostico-0.7.1` para remover instalador diagnóstico, log, temporários e target compilado. Revise o conteúdo antes; esse diretório é dedicado à build diagnóstica.
4. Para desfazer os arquivos de código desta etapa sem remover o trabalho anterior da homologação, remova `tauri.diagnostico.conf.json`, `build-diagnostico.ps1` e este documento, e reverta somente as adições de captura diagnóstica em `src-tauri/src/lib.rs`. Não remova o worktree ou a branch anterior enquanto a homologação principal ainda for necessária.

Não remova, abra ou altere caminhos associados a `com.apamind.desktop`.

## Atualização do label

A configuração usa agora o label válido `main`. O instalador corrigido está em `%TEMP%\ApaMind-Homologacao-Diagnostico-0.7.1-label-main\ApaMind-Homologacao-Diagnostico-0.7.1-main-label-x64-setup.exe`; o NSIS anterior permanece separado e inalterado. Ao reverter, remova também `%TEMP%\ApaMind-Homologacao-Diagnostico-0.7.1-label-main`.