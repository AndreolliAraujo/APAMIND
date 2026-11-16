# Ferramental de homologação

Scripts operacionais usados para gerar e auditar instaladores de homologação da versão 0.7.1.
**Não fazem parte do aplicativo**: não são executados no build normal, não são empacotados e não
afetam `npm run build` nem `npm run tauri:build`.

## Localização da raiz do repositório

Os scripts derivam a raiz a partir da própria pasta (dois níveis acima). Execute-os de qualquer
diretório de trabalho; eles localizam o repositório sozinhos.

## Arquivos

| Script | Função |
|---|---|
| `build-homologacao.ps1` | compila o instalador NSIS com identidade de homologação |
| `build-diagnostico.ps1` | compila a variante com captura de diagnóstico de inicialização |
| `compilar-homologacao-rastreavel.ps1` | build com manifesto de auditoria (SHA-256 dos artefatos) |
| `auditar-instalador-homologacao.ps1` | audita o instalador gerado contra a configuração efetiva |
| `limpar-homologacao.ps1` | limpeza dos alvos exclusivos de homologação |

Documentação de apoio: `DIAGNOSTICO-INICIALIZACAO.md`, `HOMOLOGACAO-REVERSAO.md` e
`RASTREABILIDADE-HOMOLOGACAO.md`.

## Pré-requisitos

- Windows com PowerShell, Rust com toolchain MSVC, Node e `node_modules` instalados.
- Configurações em `src-tauri/tauri.homologacao.conf.json` e `src-tauri/tauri.diagnostico.conf.json`
  (mantidas em `src-tauri/` de propósito, porque são configurações de build).

## Limitações conhecidas

- `limpar-homologacao.ps1` é **legado** do fluxo de worktree/branch temporária da 0.7.1 e mantém
  caminhos absolutos da máquina original. Revise-o antes de reutilizar. Não o reaponte para `main`:
  ele remove a branch de trabalho ao final.
- Os builds usam `CARGO_NET_OFFLINE=true` e redirecionam `TEMP`/`TMP` para pastas dedicadas.
- Os instaladores gerados não são assinados.
