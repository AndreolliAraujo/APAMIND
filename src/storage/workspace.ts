// Persistência do workspace: fila de gravação e acesso ao filesystem/armazenamento.

import { uid, type MMap, type Workspace } from "../core/model";
import { createMap } from "../core/templates";
import { SK, WorkspaceRecoveryError, localWorkspace, migrateWorkspace, parseStoredWorkspace, sameWorkspace } from "./recovery";

// Evento lancado quando o armazenamento local esta cheio.
const STORAGE_FULL_EVENT = "apamind:storage-full";

// ── Tauri fs helpers ──────────────────────────────────────────────
// Detecta se está rodando dentro do Tauri
function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI__;
}

const FS_FILENAME = "workspace.json";

export type SaveStatus = "saving" | "saved" | "error";
export type SaveResult = { success: boolean; quotaExceeded: boolean; error?: string };
const saveStateListeners = new Set<(state: SaveStatus, error?: string) => void>();
function emitSaveState(state: SaveStatus, error?: string) {
  saveStateListeners.forEach(listener => {
    try { listener(state, error); } catch (e) { console.warn("APAMIND: listener de estado de gravação falhou.", e); }
  });
}

export function onSaveState(listener: (state: SaveStatus, error?: string) => void): () => void {
  saveStateListeners.add(listener);
  return () => saveStateListeners.delete(listener);
}

function sameSerializedWorkspace(raw: string, expected: Workspace, source: string): boolean {
  return sameWorkspace(parseStoredWorkspace(raw, source), expected);
}

// O arquivo principal é substituído por rename após validar um temporário.
async function saveFsAsync(serialized: string, ws: Workspace): Promise<void> {
  const fs = await import("@tauri-apps/plugin-fs");
  const temp = `${FS_FILENAME}.tmp-${uid("save")}`;
  const options = { baseDir: fs.BaseDirectory.AppLocalData };
  await fs.writeTextFile(temp, serialized, options);
  const tempRaw = await fs.readTextFile(temp, options);
  if (!sameSerializedWorkspace(tempRaw, ws, `${FS_FILENAME} temporário`)) {
    throw new Error("A verificação do arquivo temporário falhou; o workspace.json anterior foi mantido.");
  }
  await fs.rename(temp, FS_FILENAME, {
    oldPathBaseDir: fs.BaseDirectory.AppLocalData,
    newPathBaseDir: fs.BaseDirectory.AppLocalData,
  });
  const finalRaw = await fs.readTextFile(FS_FILENAME, options);
  if (!sameSerializedWorkspace(finalRaw, ws, FS_FILENAME)) {
    throw new Error("A releitura de workspace.json não corresponde aos dados gravados.");
  }
}

// Carrega via tauri-plugin-fs
async function loadFsAsync(): Promise<Workspace | null> {
  let fs: typeof import("@tauri-apps/plugin-fs");
  try {
    fs = await import("@tauri-apps/plugin-fs");
  } catch (e) {
    throw new WorkspaceRecoveryError(`Não foi possível acessar workspace.json; nenhuma fonte alternativa foi escolhida. ${String(e)}`);
  }
  let fileExists: boolean;
  try { fileExists = await fs.exists(FS_FILENAME, { baseDir: fs.BaseDirectory.AppLocalData }); }
  catch (e) { throw new WorkspaceRecoveryError(`Não foi possível verificar workspace.json. ${String(e)}`); }
  if (!fileExists) return null;
  try {
    const raw = await fs.readTextFile(FS_FILENAME, { baseDir: fs.BaseDirectory.AppLocalData });
    return parseStoredWorkspace(raw, FS_FILENAME);
  } catch (e) {
    if (e instanceof WorkspaceRecoveryError) throw e;
    throw new WorkspaceRecoveryError(`Não foi possível ler workspace.json; o arquivo foi preservado. ${String(e)}`);
  }
}

// Fila de salvamentos pendentes — garante que saves concorrentes não se sobreponham
let _saveQueue: Promise<void> = Promise.resolve();
let _saveQueueDepth = 0;
let _lastPersistedSnapshot: string | null = null;
let _tailSnapshot: string | null = null;
let _tailSave: Promise<SaveResult> | null = null;

export function markWorkspacePersisted(ws: Workspace): void {
  try { _lastPersistedSnapshot = JSON.stringify(migrateWorkspace(ws)); }
  catch { _lastPersistedSnapshot = null; }
}

export function loadWs(): Workspace {
  // No Tauri, aguarde a leitura do arquivo antes de materializar migração v5→v6.
  const stored = localWorkspace(!isTauri());
  if (stored) {
    if (!isTauri()) markWorkspacePersisted(stored);
    return stored;
  }
  if (isTauri() && import.meta.env.VITE_APAMIND_HOMOLOGACAO === "1") {
    const emptyMap: MMap = {
      id: uid("map"),
      title: "Meu Primeiro Mapa",
      template: "Livre",
      ts: new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    return { active: emptyMap.id, maps: [emptyMap] };
  }
  const m = createMap("Meu Primeiro Mapa", "Modelo A");
  return { active: m.id, maps: [m] };
}

// Carrega do filesystem (Tauri) e retorna o workspace mais recente.
// Deve ser chamado no boot do app para sobrescrever o estado inicial.
export async function loadWsAsync(): Promise<Workspace | null> {
  if (!isTauri()) return null;
  const fs = await loadFsAsync();
  // Não crie v6 a partir de v5 antes de comparar com workspace.json.
  const local = localWorkspace(fs === null);
  if (!local) {
    if (fs) markWorkspacePersisted(fs);
    return fs;
  }
  if (!fs) return local;
  if (!sameWorkspace(local, fs)) {
    throw new WorkspaceRecoveryError("As cópias do localStorage e workspace.json divergem. Ambas foram preservadas; escolha manual é necessária.");
  }
  markWorkspacePersisted(fs);
  return local;
}

export function saveWs(ws: Workspace): Promise<SaveResult> {
  let snapshot: Workspace;
  let serialized: string;
  try {
    snapshot = migrateWorkspace(ws);
    serialized = JSON.stringify(snapshot);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    emitSaveState("error", message);
    return Promise.resolve({ success: false, quotaExceeded: false, error: message });
  }
  if (_saveQueueDepth === 0 && _lastPersistedSnapshot === serialized) {
    return Promise.resolve({ success: true, quotaExceeded: false });
  }
  if (_saveQueueDepth > 0 && _tailSnapshot === serialized && _tailSave) return _tailSave;

  _saveQueueDepth += 1;
  const operation = _saveQueue.then(async (): Promise<SaveResult> => {
    let quotaExceeded = false;
    try {
      emitSaveState("saving");
      // No desktop, localStorage é uma cópia de recuperação preparada antes
      // do commit do arquivo; nunca é usada para sobrescrever o arquivo.
      try { localStorage.setItem(SK, serialized); }
      catch (error) {
        quotaExceeded = error instanceof DOMException && error.name === "QuotaExceededError";
        console.warn("APAMIND: Falha ao atualizar a cópia de recuperação local.", error);
        try { window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: String(error) })); } catch { /* ambiente sem DOM */ }
        if (!isTauri()) throw error;
      }

      if (isTauri()) await saveFsAsync(serialized, snapshot);
      emitSaveState("saved");
      return { success: true, quotaExceeded };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      console.error("APAMIND: Falha ao salvar workspace.", error);
      emitSaveState("error", message);
      return { success: false, quotaExceeded, error: message };
    }
  });
  // Recupera a fila após qualquer rejeição inesperada para permitir o próximo save.
  const tracked = operation.then(result => {
    _saveQueueDepth -= 1;
    if (result.success) _lastPersistedSnapshot = serialized;
    else _lastPersistedSnapshot = null;
    return result;
  }, error => {
    _saveQueueDepth -= 1;
    _lastPersistedSnapshot = null;
    const message = String(error instanceof Error ? error.message : error);
    emitSaveState("error", message);
    return { success: false, quotaExceeded: false, error: message };
  });
  _tailSnapshot = serialized;
  _tailSave = tracked;
  _saveQueue = tracked.then(() => undefined, () => undefined);
  return tracked;
}

// Flush síncrono-compatível para beforeunload: dispara o save fs e retorna a promise
export function flushSave(ws: Workspace): Promise<void> {
  return saveWs(ws).then(() => undefined);
}

// Helper para App escutar estado de armazenamento cheio
export function onStorageFull(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(STORAGE_FULL_EVENT, handler);
  return () => window.removeEventListener(STORAGE_FULL_EVENT, handler);
}