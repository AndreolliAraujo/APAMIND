# Checklist de desenvolvimento e empacotamento ApaMind 0.7.2

## Antes de compilar

- [ ] Node.js `^20.19.0` ou `>=22.12.0`.
- [ ] Rust stable e toolchain MSVC no Windows.
- [ ] Visual Studio Build Tools com C++ Desktop e Windows SDK.
- [ ] WebView2 Runtime disponível no Windows.
- [ ] Dependências instaladas pelo lockfile: `npm.cmd ci`.
- [ ] `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` declaram versão `0.7.2`.
- [ ] Ícones `icon.ico`, PNGs e `icon.icns` presentes em `src-tauri/icons/`.

## Verificações

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
git diff --check
npm.cmd run build
cargo check --offline -j 1
```

## Aplicativo desktop

Desenvolvimento:

```powershell
npm.cmd run tauri:dev
```

Empacotamento para a plataforma atual:

```powershell
npm.cmd run tauri:build
```

No Windows, confira os bundles em `src-tauri\target\release\bundle\msi\` e `src-tauri\target\release\bundle\nsis\`. O build usa temporários sob `.tmp/` no projeto. Este procedimento gera artefatos locais; não publica instaladores.

## Antes de distribuir

- [ ] Instalar e iniciar o bundle em máquina de teste limpa.
- [ ] Confirmar dados de workspace, links HTTP(S), anexos, importação e exportação.
- [ ] Configurar certificado de assinatura para distribuir instaladores Windows sem aviso de editor desconhecido.
- [ ] Definir canal de distribuição, política de atualização e processo de release.
- [ ] Criar e validar backups de dados de teste; nunca usar workspace real em experimentos.

Não ampliar permissões Tauri para contornar problemas de abertura. A capability atual restringe protocolos e caminhos locais.