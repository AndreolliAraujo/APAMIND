import type { MMap } from "../../core/model";
import { download, safeName } from "./files";

// ── Export JSON ───────────────────────────────────────────────────
export function exportJSON(map: MMap) {
  const blob = new Blob([serializeMapJSON(map)], { type: "application/json" });
  download(blob, `${safeName(map.title)}.apamind.json`);
}

// ── Export Backup (Tudo) ──────────────────────────────────────────
export function exportWorkspaceBackup(maps: MMap[]) {
  const now = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const blob = new Blob([serializeWorkspaceBackup(maps)], { type: "application/json" });
  download(blob, `apamind_backup_${now}.json`);
}

export function serializeMapJSON(map: MMap): string {
  return JSON.stringify(map, null, 2);
}

export function serializeWorkspaceBackup(maps: MMap[]): string {
  const data = {
    type: "apamind_backup",
    version: "1.0",
    ts: new Date().toISOString(),
    maps,
  };
  return JSON.stringify(data, null, 2);
}
