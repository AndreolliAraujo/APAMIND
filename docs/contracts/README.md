# Contrato do formato `workspace.json`

Este diretório documenta o formato do arquivo de workspace do ApaMind.

- `workspace.schema.json` — contrato de referência (JSON Schema draft 2020-12).
- A **validação executável** vive em `src/core/validation.ts` (importação) e em
  `src/storage/recovery.ts` (carga). O schema aqui é documentação, não um segundo validador:
  os dois podem divergir em detalhes de mensagem, mas não em semântica.

## Regras de versão

- `schemaVersion` é gravado em cada mapa pela migração (`migrateWorkspace`).
- Uma versão **maior** que a suportada deve ser **recusada sem tocar no arquivo**, nunca rebaixada
  silenciosamente (ver `FutureVersionError` na Fase E).
- `additionalProperties: true` em todos os níveis é intencional: dados desconhecidos de versões
  futuras são preservados, não descartados.
