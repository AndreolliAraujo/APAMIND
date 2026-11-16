import type { WorkspaceConflict } from "../workspace";
import { download } from "./files";

/**
 * Exporta as duas cópias brutas (arquivo e armazenamento local) para um JSON,
 * sem alterar nenhuma delas. Serve como backup antes de qualquer escolha.
 */
export function exportRecoveryCopies(conflict: WorkspaceConflict): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const payload = {
    type: "apamind_recovery",
    version: "1.0",
    ts: new Date().toISOString(),
    detail: conflict.detail,
    file: conflict.file.raw,
    local: conflict.local.raw,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  download(blob, `apamind_recuperacao_${stamp}.json`);
}
