import { MAX_IMPORT_BYTES, type ImportFileResult } from "./types";
import { importFreeMind } from "./freemind";
import { importJSON, importWorkspaceBackup } from "./json";
import { importMarkdown } from "./markdown";
import { importMindMeister } from "./opml";
import { importXMind } from "./xmind";

export async function importFile(file: File): Promise<ImportFileResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "Arquivo maior que 50MB" };
  const name = file.name.toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, "");
  try {
    if (name.endsWith(".json")) {
      const backup = await importWorkspaceBackup(file);
      if (backup.ok) return { ok: true, kind: "backup", maps: backup.maps };
      if (!backup.error.startsWith("Não é um backup do APAMIND")) return backup;
      const imported = await importJSON(file);
      return imported.ok ? { ok: true, kind: "map", map: imported.map } : imported;
    }
    if (name.endsWith(".md") || name.endsWith(".markdown")) {
      return { ok: true, kind: "map", map: importMarkdown(await file.text(), baseName) };
    }
    if (name.endsWith(".mm")) {
      return { ok: true, kind: "map", map: importFreeMind(await file.text(), baseName) };
    }
    if (name.endsWith(".xmind")) {
      const imported = await importXMind(file);
      return imported.ok ? { ok: true, kind: "map", map: imported.map } : imported;
    }
    if (name.endsWith(".opml")) {
      return { ok: true, kind: "map", map: importMindMeister(await file.text(), baseName) };
    }
    return { ok: false, error: "Tipo de arquivo não suportado." };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}


export { importJSON, importWorkspaceBackup } from "./json";
export { importMarkdown } from "./markdown";
export { importFreeMind } from "./freemind";
export { importXMind } from "./xmind";
export { importMindMeister } from "./opml";
export type { ImportBackupResult, ImportFileResult, ImportMapResult, ImportResult } from "./types";
