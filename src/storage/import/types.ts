import type { MMap } from "../../core/model";

// ── Erro tipado de importacao ─────────────────────────────────────
export type ImportMapResult = { ok: true; map: MMap } | { ok: false; error: string };
export type ImportBackupResult = { ok: true; maps: MMap[] } | { ok: false; error: string };
export type ImportResult = ImportMapResult | ImportBackupResult;
export type ImportFileResult =
  | { ok: true; kind: "map"; map: MMap }
  | { ok: true; kind: "backup"; maps: MMap[] }
  | { ok: false; error: string };

// ── Tamanho maximo de arquivo importado (50 MB) ──────────────────
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
