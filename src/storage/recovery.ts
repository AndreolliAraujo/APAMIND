// Recuperação e migração do workspace persistido.
// Interpreta as cópias de armazenamento sem escolher silenciosamente entre versões.

import { SCHEMA_VERSION, legacyLinksToAttachments, uid, type EdgeStyle, type NodeShape, type Workspace } from "../core/model";
import { createMap } from "../core/templates";

// Chaves de armazenamento local: v6 é a atual, v5 é legado de migração.
export const SK = "apamind.v6";
const LEGACY_SK = "apamind.v5";

export class WorkspaceRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRecoveryError";
  }
}

// ── Persistência ──────────────────────────────────────────────────
// Etapas de migracao aplicadas ao carregar qualquer Workspace gravado por
// versoes anteriores. Cada passo preenche campos opcionais adicionados
// entre releases para garantir formato consistente na memoria.
export function migrateWorkspace(ws: Workspace): Workspace {
  if (!ws || !Array.isArray(ws.maps)) {
    const m = createMap("Meu Primeiro Mapa", "Modelo A");
    return { active: m.id, maps: [m] };
  }
  // Garante defaults seguros em cada mapa/no
  const maps = ws.maps.map((m) => ({
    id: m.id || uid("map"),
    title: m.title || "Mapa sem título",
    template: m.template || "Livre",
    ts: m.ts || new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    nodes: (m.nodes || []).map((n) => ({
      ...n,
      // Campos opcionais adicionados em versoes posteriores
      note: typeof n.note === "string" ? n.note : "",
      markdown: typeof n.markdown === "string" ? n.markdown : undefined,
      checklist: Array.isArray(n.checklist) ? n.checklist : undefined,
      icon: typeof n.icon === "string" ? n.icon : undefined,
      links: undefined,
      attachments: legacyLinksToAttachments(n.attachments, (n as { links?: unknown }).links),
      shape: (n.shape as NodeShape) || "card",
      tone: typeof n.tone === "number" ? n.tone : 0,
      scale: typeof n.scale === "number" ? n.scale : undefined,
      borderColor: typeof n.borderColor === "string" ? n.borderColor : undefined,
      x: Number.isFinite(n.x) ? n.x : 0,
      y: Number.isFinite(n.y) ? n.y : 0,
    })),
    edges: (m.edges || []).map((e) => ({
      ...e,
      style: (e.style as EdgeStyle) || "solid",
    })),
  }));
  const activeId = ws.active && maps.some(m => m.id === ws.active) ? ws.active : (maps[0]?.id ?? "");
  return { active: activeId, maps };
}

export function parseStoredWorkspace(raw: string, source: string): Workspace {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new WorkspaceRecoveryError(`A cópia ${source} contém JSON inválido e foi preservada.`); }
  const candidate = parsed as Workspace;
  if (!candidate || !Array.isArray(candidate.maps) || candidate.maps.length === 0 ||
      !candidate.maps.every(m => m && typeof m === "object" && Array.isArray(m.nodes) && Array.isArray(m.edges))) {
    throw new WorkspaceRecoveryError(`A cópia ${source} não tem um workspace recuperável e foi preservada.`);
  }
  return migrateWorkspace(candidate);
}

export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function localWorkspace(allowMigration = true): Workspace | null {
  let current: string | null;
  let legacy: string | null;
  try {
    current = localStorage.getItem(SK);
    legacy = localStorage.getItem(LEGACY_SK);
  } catch {
    throw new WorkspaceRecoveryError("Não foi possível ler o armazenamento local. Nenhum workspace vazio foi criado.");
  }
  if (current === null && legacy === null) return null;
  const currentWs = current === null ? null : parseStoredWorkspace(current, SK);
  const legacyWs = legacy === null ? null : parseStoredWorkspace(legacy, LEGACY_SK);
  if (currentWs && legacyWs && !sameWorkspace(currentWs, legacyWs)) {
    throw new WorkspaceRecoveryError("As cópias apamind.v5 e apamind.v6 divergem. Ambas foram preservadas; escolha manual é necessária.");
  }
  if (currentWs) return currentWs;
  if (!legacyWs) return null;
  if (!allowMigration) return legacyWs;

  // Migração por cópia: v5 permanece intocada e v6 só é aceita após releitura.
  try {
    localStorage.setItem(SK, JSON.stringify(legacyWs));
    const reread = localStorage.getItem(SK);
    if (reread === null || !sameWorkspace(parseStoredWorkspace(reread, SK), legacyWs)) {
      throw new Error("A releitura da cópia migrada não corresponde à origem.");
    }
  } catch (e) {
    throw new WorkspaceRecoveryError(`A migração de apamind.v5 para apamind.v6 não foi confirmada; a origem foi preservada. ${String(e)}`);
  }
  return legacyWs;
}
