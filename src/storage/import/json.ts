import type { MMap } from "../../core/model";
import { remapMapReferences } from "../../core/references";
import { validateMMap } from "../../core/validation";
import { MAX_IMPORT_BYTES, type ImportBackupResult, type ImportMapResult } from "./types";

// ── Import JSON ───────────────────────────────────────────────────
export async function importJSON(file: File): Promise<ImportMapResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "Arquivo maior que 50MB" };
  try {
    const text = await file.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "JSON inválido: " + String(e) };
    }
    const v = validateMMap(data);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, map: v.map };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Import Backup (Tudo) ──────────────────────────────────────────
export async function importWorkspaceBackup(file: File): Promise<ImportBackupResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "Arquivo maior que 50MB" };
  try {
    const text = await file.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "JSON inválido: " + String(e) };
    }
    if (data?.type !== "apamind_backup" || !Array.isArray(data.maps)) {
      return { ok: false, error: "Não é um backup do APAMIND (faltam 'type' ou 'maps')" };
    }
    if (data.version && data.version !== "1.0") {
      return { ok: false, error: `Versão de backup não suportada: ${data.version}` };
    }
    // O id original de cada mapa é capturado antes da validação, porque
    // validateMMap reatribui ids novos. Assim podemos remapear referências
    // internas map://<idAntigo> para o id novo correspondente.
    const originalIds: (string | null)[] = data.maps.map((m: unknown) =>
      m && typeof m === "object" && typeof (m as Record<string, unknown>).id === "string"
        ? ((m as Record<string, unknown>).id as string)
        : null,
    );
    const validated: MMap[] = [];
    for (const m of data.maps) {
      const v = validateMMap(m);
      if (!v.ok) return { ok: false, error: `Mapa inválido no backup: ${v.error}` };
      validated.push(v.map);
    }
    if (!validated.length) return { ok: false, error: "Backup não contém mapas válidos" };

    const mapIdMap = new Map<string, string>();
    validated.forEach((map, index) => {
      const originalId = originalIds[index];
      if (originalId) mapIdMap.set(originalId, map.id);
    });

    return { ok: true, maps: validated.map((map) => remapMapReferences(map, mapIdMap)) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
