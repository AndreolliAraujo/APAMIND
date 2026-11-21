// ═══════════════════════════════════════════════════════════════════
//  APAMIND v2 — Editor completo de mapas mentais
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  type MMap,
  type MNode,
  type MEdge,
  type TemplateName,
  type Attachment,
  type EdgeStyle,
  type Workspace,
  TEMPLATES,
  ATTACH_TYPES,
  ATTACH_ICONS,
  uid,
  clamp,
  mkNode,
  mkEdge,
} from "./core/model";
import { collectBrokenMapLinks, countMapReferences, normalizeReferenceKey } from "./core/references";
import { edgePath } from "./core/geometry";
import { TONES, TONE_HEX, SHAPES, shapeClass } from "./ui/theme";
import { createMap } from "./core/templates";
import {
  autoLayoutTree,
  autoLayoutRadial,
  autoLayoutFlow,
  autoLayoutOrgChart,
  autoLayoutFishbone,
  autoLayoutMindMap,
  autoLayoutTimeline,
  autoLayoutGrid,
  getTemplateLayout,
} from "./core/layout";
import {
  loadWs,
  saveWs,
  flushSave,
  onStorageFull,
  onSaveState,
  markWorkspacePersisted,
  preserveRecoveryCopy,
  resolveBootWorkspace,
  type SaveStatus,
  type WorkspaceConflict,
} from "./storage/workspace";
import {
  exportJSON,
  exportMarkdown,
  exportSVG,
  exportPNG,
  exportHTML,
  printMap,
  exportWorkspaceBackup,
  exportRecoveryCopies,
} from "./storage/export";
import { importFile } from "./storage/import";
import { createCloseGuard, type CloseFailureStage, type CloseGuard } from "./closeGuard";
import { createCloseProtectionController, isWebDevelopmentMode, type CloseProtectionStatus } from "./closeProtection";
import { normalizeSchemeLessWebAddress } from "./attachmentSecurity";
import { openAttachment } from "./attachmentActions";
import {
  addNodeToMap,
  copyMapSelection,
  pasteMapSelection,
  removeEdgeFromMap,
  removeMapFromWorkspace,
  removeNodesFromMap,
  updateNodeInMap,
  type MapClipboard,
} from "./mapOperations";
import { createMapHistory, recordMapHistory, redoMapHistory, undoMapHistory } from "./mapHistory";
import {
  BACKGROUND_PRESETS,
  PATTERN_CSS,
  PATTERN_SIZES,
  hexToRgba,
  rgbaToHex,
  type BackgroundPreset,
} from "./backgrounds";
import { CloseFailureDialog, ColorInput, CtxBtn, EmojiPicker } from "./components/AppControls";
import { RecoveryDialog } from "./components/RecoveryDialog";

// ── Types ──────────────────────────────────────────────────────────

type DragInfo =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number }
  | {
      type: "drag";
      nodeId: string;
      ox: number;
      oy: number;
      initials: Map<string, { x: number; y: number }>;
      saved: boolean;
    }
  | { type: "connect"; sourceId: string }
  | { type: "lasso"; sx: number; sy: number; ex: number; ey: number }
  | null;

type CtxMenu = {
  x: number;
  y: number;
  nodeId?: string;
  edgeId?: string;
  wx?: number;
  wy?: number;
} | null;

// ── Markdown renderer (simple) ─────────────────────────────────────

function iconBg(tone: number, isDark: boolean) {
  const t = TONES[tone % TONES.length];
  if (!t) return isDark ? "bg-white/8 border border-white/20 backdrop-blur-sm" : "bg-black/5 border border-black/12";
  return `bg-gradient-to-br ${t}`;
}

function escapeHtml(s: string) {
  const AMP = String.fromCharCode(38);
  const LT = AMP + "lt;";
  const GT = AMP + "gt;";
  const QUOT = AMP + "quot;";
  const APOS = AMP + "#39;";
  return s.replace(/&/g, AMP).replace(/</g, LT).replace(/>/g, GT).replace(/"/g, QUOT).replace(/'/g, APOS);
}

// Escapa texto puro antes de aplicar formatadores markdown.
// Resultado é HTML seguro (entidades); URLs dos links são validadas por scheme.
// DOMPurify disponível caso queira sanitizar conteúdo importado no futuro.

// Links em notas NÃO navegam o WebView: o clique é interceptado e delegado ao
// mesmo caminho validado usado pelos anexos (attachmentSecurity + Opener).
function renderMarkdown(text: string, onOpenUrl?: (url: string) => void) {
  if (!text) return null;
  const SCHEME_OK = /^https?:\/\//i;
  const Q = String.fromCharCode(34); // aspa dupla
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // 1. Escapa todo o conteúdo
    let escaped = escapeHtml(line);
    // 2. Aplica formatação inline em cima do escapado
    escaped = escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((.+?)\)/g, (_m: string, label: string, url: string) => {
        if (!SCHEME_OK.test(url)) return label;
        const safeUrl = url.replace(/"/g, String.fromCharCode(38) + "quot;");
        return (
          "<a href=" +
          Q +
          safeUrl +
          Q +
          " class=" +
          Q +
          "underline text-indigo-400 cursor-pointer" +
          Q +
          ">" +
          label +
          "</a>"
        );
      });
    const safe = DOMPurify.sanitize(escaped);
    const handleClick = onOpenUrl
      ? (event: React.MouseEvent<HTMLParagraphElement>) => {
          const anchor = (event.target as HTMLElement).closest("a");
          if (!anchor) return;
          event.preventDefault();
          const href = anchor.getAttribute("href") ?? "";
          if (href) onOpenUrl(href);
        }
      : undefined;
    return (
      <p key={i} className="text-xs leading-relaxed" onClick={handleClick} dangerouslySetInnerHTML={{ __html: safe }} />
    );
  });
}

// ── Main App ───────────────────────────────────────────────────────

function CloseSavingNotice({ open, slow }: { open: boolean; slow: boolean }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <section className="flex max-w-md items-center gap-4 rounded-2xl border border-indigo-400/30 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        {!slow && (
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent"
          />
        )}
        <div>
          <p className="font-semibold">
            {slow ? "O salvamento ainda está em andamento" : "Salvando os dados antes de fechar..."}
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {slow
              ? "O aplicativo permanece aberto. Aguarde a operação atual terminar; nenhuma nova gravação será iniciada enquanto isso."
              : "O fechamento continuará automaticamente após a gravação."}
          </p>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [initialLoad] = useState(() => {
    try {
      return { workspace: loadWs(), error: null as string | null };
    } catch (e) {
      const placeholder = createMap("Dados aguardando recuperação", "Modelo A");
      return { workspace: { active: placeholder.id, maps: [placeholder] }, error: String(e) };
    }
  });
  const [bootIssue, setBootIssue] = useState<string | null>(initialLoad.error);
  const [bootReady, setBootReady] = useState(false);
  const [conflict, setConflict] = useState<WorkspaceConflict | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [ws, setWs] = useState<Workspace>(initialLoad.workspace);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeSaveSlow, setCloseSaveSlow] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeFailureStage, setCloseFailureStage] = useState<CloseFailureStage>("save");
  const [closeProtectionStatus, setCloseProtectionStatus] = useState<CloseProtectionStatus>("initializing");
  const [closeProtectionError, setCloseProtectionError] = useState<string | null>(null);
  const map = ws.maps.find((m) => m.id === ws.active) ?? ws.maps[0];
  // map nunca e undefined aqui: loadWs() garante workspace com maps via migrateWorkspace
  const nodeMap = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);
  const brokenLinks = useMemo(() => collectBrokenMapLinks(ws.maps), [ws.maps]);

  // Canvas
  const canvasRef = useRef<HTMLDivElement>(null);
  // O canvas só monta depois das telas de boot; guardar o elemento em estado (via
  // callback ref) permite religar listeners nativos quando ele realmente aparece.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const setCanvasNode = useCallback((el: HTMLDivElement | null) => {
    canvasRef.current = el;
    setCanvasEl(el);
  }, []);
  const [vp, setVp] = useState({ x: 0, y: 0, zoom: 1 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const bootReadyRef = useRef(bootReady);
  bootReadyRef.current = bootReady;
  const bootIssueRef = useRef(bootIssue);
  bootIssueRef.current = bootIssue;
  const conflictRef = useRef<WorkspaceConflict | null>(conflict);
  conflictRef.current = conflict;
  const closeGuardRef = useRef<CloseGuard | null>(null);
  const closeProtectionStartedRef = useRef(false);
  const retryCloseProtectionRef = useRef<() => void>(() => {});

  // Selection & editing
  const [sel, setSel] = useState(new Set<string>());
  const selRef = useRef(sel);
  selRef.current = sel;
  const selected = sel.size === 1 ? (nodeMap.get([...sel][0]) ?? null) : null;
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editField, setEditField] = useState<"title" | "note" | "markdown">("title");

  // Collapse state — inicializado do mapa ativo e persistido nele
  const [collapsed, setCollapsed] = useState(() => new Set<string>(map.collapsedIds ?? []));

  // Sincroniza collapsed ao trocar de mapa
  const prevMapId = useRef(map.id);
  useEffect(() => {
    if (map.id !== prevMapId.current) {
      prevMapId.current = map.id;
      setCollapsed(new Set(map.collapsedIds ?? []));
    }
  }, [map.id, map.collapsedIds]);

  // Drag / connect
  const dragRef = useRef<DragInfo>(null);
  const [connectLine, setConnectLine] = useState<{ sourceId: string; mx: number; my: number } | null>(null);
  const [lassoRect, setLassoRect] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const [cursor, setCursor] = useState<"grab" | "grabbing" | "crosshair" | "default">("grab");

  // Context menu & modals
  const [ctx, setCtx] = useState<CtxMenu>(null);
  const [ctxCopyToMap, setCtxCopyToMap] = useState(false);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTpl, setDraftTpl] = useState<TemplateName>("Modelo A");
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // UI states
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [editingMapTitle, setEditingMapTitle] = useState(false);
  const [mapTitleDraft, setMapTitleDraft] = useState("");
  const [showStorageFull, setShowStorageFull] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchResults = useMemo(
    () =>
      searchQuery.trim()
        ? map.nodes.filter(
            (n) =>
              n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              n.note?.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : [],
    [searchQuery, map.nodes],
  );
  const [notesEditMode, setNotesEditMode] = useState(false);
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [checklistNodeId, setChecklistNodeId] = useState<string | null>(null);
  const [newCheckItem, setNewCheckItem] = useState("");
  const [background, setBackground] = useState<BackgroundPreset>({
    name: "Aurora",
    baseDark: "#080a12",
    baseLight: "#f5f2ec",
    glowA: "rgba(99,102,241,.55)",
    glowB: "rgba(244,114,182,.40)",
    glowC: "rgba(45,212,191,.30)",
    pattern: "none",
    animated: true,
  });

  // Clipboard
  const [clipboard, setClipboard] = useState<MapClipboard | null>(null);

  // Undo / redo
  const [history, setHistory] = useState(createMapHistory);
  const { past, future } = history;

  // ── Persistence ──────────────────────────────────────
  // Persistence (debounced 500ms) - evita thrash durante drag/keystroke
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!bootReady || bootIssue) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveWs(ws).then((result) => {
        if (result.quotaExceeded) setShowStorageFull(true);
      });
    }, 500);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [ws, bootReady, bootIssue]);

  // Fallback web: no desktop o evento nativo de fechamento controla o flush e evita duplicidade.
  useEffect(() => {
    // Desktop close is coordinated by Tauri; beforeunload remains the web fallback.
    if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) return;
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      flushSave(wsRef.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  useEffect(() => {
    if (closeProtectionStartedRef.current) return;
    closeProtectionStartedRef.current = true;

    const tauriBridge = (window as any).__TAURI__;
    const tauriRuntime = (window as any).__TAURI_INTERNALS__;
    if (isWebDevelopmentMode(import.meta.env.DEV, Boolean(tauriBridge), Boolean(tauriRuntime))) {
      setCloseProtectionStatus("ready");
      return;
    }

    const getTauriWindow = () => {
      try {
        return tauriBridge?.window?.getCurrentWindow?.() ?? null;
      } catch {
        return null;
      }
    };
    const cancelDebounce = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
    const guard = createCloseGuard({
      cancelDebounce,
      getWorkspace: () => wsRef.current,
      saveWorkspace: async (snapshot) => {
        if (bootIssueRef.current) return { success: true, quotaExceeded: false };
        if (conflictRef.current) return { success: true, quotaExceeded: false };
        if (!bootReadyRef.current) {
          return {
            success: false,
            quotaExceeded: false,
            error: "O ApaMind ainda está verificando os arquivos de dados. Tente fechar novamente em instantes.",
          };
        }
        return saveWs(snapshot);
      },
      closeWindow: async () => {
        const appWindow = getTauriWindow();
        if (typeof appWindow?.destroy !== "function")
          throw new Error("A API para fechar a janela do Tauri está indisponível.");
        await appWindow.destroy();
      },
      slowSaveTimeoutMs: 15_000,
      onSaving: (saving) => {
        setCloseSaving(saving);
        if (!saving) setCloseSaveSlow(false);
      },
      onSavingSlow: setCloseSaveSlow,
      onDiagnostic: (event, elapsedMs) => {
        console.warn("[APAMIND_CLOSE] " + event + (elapsedMs === undefined ? "" : " elapsedMs=" + elapsedMs));
      },
      onError: (error, stage) => {
        setCloseFailureStage(stage);
        setCloseError(error || null);
        setCloseDialogOpen(Boolean(error));
      },
    });
    closeGuardRef.current = guard;

    const controller = createCloseProtectionController({
      getWindow: getTauriWindow,
      confirmNativeProtection: async () => {
        if (typeof tauriBridge?.core?.invoke !== "function")
          throw new Error("A API de confirmação nativa do Tauri está indisponível.");
        await tauriBridge.core.invoke("mark_close_listener_ready");
      },
      onCloseRequested: (event) => closeGuardRef.current?.onCloseRequested(event),
      onStatus: (status, error) => {
        setCloseProtectionStatus(status);
        setCloseProtectionError(error ?? null);
      },
    });
    retryCloseProtectionRef.current = () => {
      void controller.retry();
    };
    void controller.start();
  }, []);

  // Boot: resolve as fontes de dados; divergência vira decisão do usuário, não bloqueio mudo.
  useEffect(() => {
    resolveBootWorkspace()
      .then((outcome) => {
        if (outcome.kind === "conflict") {
          setConflict(outcome.conflict);
          return;
        }
        if (outcome.kind === "ready") {
          setWs(outcome.workspace);
          setBootIssue(null);
        }
        if (!initialLoad.error) setBootReady(true);
      })
      .catch((e) => setBootIssue(String(e)));
  }, [initialLoad.error]);

  async function applyFileCopy() {
    if (!conflict?.file.workspace) return;
    setRecoveryBusy(true);
    try {
      setWs(conflict.file.workspace);
      markWorkspacePersisted(conflict.file.workspace);
      setConflict(null);
      setBootIssue(null);
      setBootReady(true);
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function applyLocalCopy() {
    if (!conflict?.local.workspace) return;
    setRecoveryBusy(true);
    try {
      if (conflict.file.raw !== null) {
        try {
          await preserveRecoveryCopy(conflict.file.raw, String(Date.now()));
        } catch (e) {
          window.alert(`Não foi possível preservar o arquivo atual: ${String(e)}`);
          return;
        }
      }
      const target = conflict.local.workspace;
      setWs(target);
      setConflict(null);
      setBootIssue(null);
      setBootReady(true);
      void saveWs(target);
    } finally {
      setRecoveryBusy(false);
    }
  }

  function exportRecovery() {
    if (conflict) exportRecoveryCopies(conflict);
  }

  function closeWithoutChanges() {
    const appWindow = (window as any).__TAURI__?.window?.getCurrentWindow?.();
    if (appWindow?.close) void appWindow.close();
  }

  // Avisa usuario se armazenamento local encher (QuotaExceededError)
  useEffect(
    () =>
      onStorageFull(() => {
        setShowStorageFull(true);
      }),
    [],
  );

  useEffect(
    () =>
      onSaveState((state, error) => {
        setSaveStatus(state);
        setSaveError(state === "error" ? (error ?? "Falha desconhecida ao salvar.") : null);
      }),
    [],
  );

  // ── Fit to view on map change ────────────────────────
  // fitView lê refs e estado derivado; incluí-lo nas deps reexecutaria a cada render.
  useEffect(() => {
    requestAnimationFrame(fitView);
  }, [map.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme helpers ────────────────────────────────────
  const bg = isDark ? "text-slate-100" : "text-slate-900";
  const panel = isDark
    ? "border-white/10 bg-white/[.04] backdrop-blur-2xl"
    : "border-black/8 bg-white/70 backdrop-blur-2xl";
  const inp = isDark ? "border-white/10 bg-white/5 text-white" : "border-black/10 bg-white text-slate-900";
  const btn = isDark
    ? "border-white/10 bg-white/5 hover:bg-white/10 text-slate-200"
    : "border-black/10 bg-white hover:bg-slate-50 text-slate-700";
  const edgeClr = isDark ? "rgba(165,180,252,0.4)" : "rgba(79,70,229,0.3)";
  const edgeHi = isDark ? "rgba(165,180,252,0.8)" : "rgba(79,70,229,0.7)";

  // ── Core helpers ─────────────────────────────────────
  function updMap(fn: (m: MMap) => MMap) {
    setWs((w) => ({ ...w, maps: w.maps.map((m) => (m.id === w.active ? fn(m) : m)) }));
  }

  function pushUndo() {
    const m = wsRef.current.maps.find((m) => m.id === wsRef.current.active);
    if (!m) return;
    recordHistory(m);
  }

  function recordHistory(m: MMap) {
    setHistory((current) => recordMapHistory(current, m));
  }

  function undo() {
    const result = undoMapHistory(history, map);
    if (!result.map) return;
    setHistory(result.history);
    updMap(() => result.map!);
  }

  function redo() {
    const result = redoMapHistory(history, map);
    if (!result.map) return;
    setHistory(result.history);
    updMap(() => result.map!);
  }

  // ── Visibility (collapse) ────────────────────────────
  // Visibility: Set memoizado (pre-computado por change de edges/collapsed)
  // Em vez de O(n*depth) por render, calcula O(n+e) uma vez por mudanca.
  const parentMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of map.edges) if (!m.has(e.target)) m.set(e.target, e.source);
    return m;
  }, [map.edges]);
  // hasKids: conjunto de ids que sao source de ao menos uma edge
  const hasKids = useMemo(() => {
    const s = new Set<string>();
    for (const e of map.edges) s.add(e.source);
    return s;
  }, [map.edges]);
  const visibleSet = useMemo(() => {
    const s = new Set<string>();
    for (const n of map.nodes) {
      let p = parentMap.get(n.id);
      let visible = true;
      const guard = new Set<string>();
      while (p) {
        if (guard.has(p)) break;
        guard.add(p);
        if (collapsed.has(p)) {
          visible = false;
          break;
        }
        p = parentMap.get(p);
      }
      if (visible) s.add(n.id);
    }
    return s;
  }, [map.nodes, parentMap, collapsed]);
  function isVisible(nodeId: string) {
    return visibleSet.has(nodeId);
  }

  function toggleCollapse(nodeId: string) {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(nodeId)) {
        n.delete(nodeId);
      } else {
        n.add(nodeId);
      }
      updMap((m) => ({ ...m, collapsedIds: [...n] }));
      return n;
    });
  }

  // ── Auto layout ──────────────────────────────────────
  type LayoutMode = "tree" | "radial" | "flow" | "org" | "fishbone" | "mindmap" | "timeline" | "grid";

  function applyLayout(mode: LayoutMode) {
    pushUndo();
    updMap((m) => {
      const root = m.nodes[0]?.id;
      const nodes =
        mode === "tree"
          ? autoLayoutTree(m.nodes, m.edges, root)
          : mode === "org"
            ? autoLayoutOrgChart(m.nodes, m.edges, root)
            : mode === "fishbone"
              ? autoLayoutFishbone(m.nodes, m.edges, root)
              : mode === "radial"
                ? autoLayoutRadial(m.nodes, m.edges, root)
                : mode === "mindmap"
                  ? autoLayoutMindMap(m.nodes, m.edges, root)
                  : mode === "timeline"
                    ? autoLayoutTimeline(m.nodes, m.edges)
                    : mode === "grid"
                      ? autoLayoutGrid(m.nodes)
                      : autoLayoutFlow(m.nodes, m.edges);
      return { ...m, nodes };
    });
    setShowLayoutModal(false);
    requestAnimationFrame(fitView);
  }

  function autoOrganize() {
    const tpl = getTemplateLayout(map.template);
    applyLayout(tpl === "none" ? "mindmap" : tpl);
  }

  // ── Focus on node with fade transition ───────────────
  function focusOnSelected() {
    if (!selected) return;
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    const zoom = 1.4;
    setVp({
      x: r.width / 2 - selected.x * zoom,
      y: r.height / 2 - selected.y * zoom,
      zoom,
    });
  }

  // ── Node / edge actions ──────────────────────────────
  function addNodeAt(x: number, y: number, parentId?: string) {
    pushUndo();
    const n = mkNode("Nova ideia", "Duplo clique para editar", x, y, TONES.length - 1);
    updMap((m) => ({ ...addNodeToMap(m, n, parentId), ts: new Date().toISOString() }));
    setSel(new Set([n.id]));
  }

  function addChildNode(parentId: string) {
    const p = nodeMap.get(parentId);
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    addNodeAt(p.x + Math.cos(a) * 200, p.y + Math.sin(a) * 150, parentId);
  }

  function deleteNodes(ids: Set<string>) {
    if (ids.size === 0) return;
    pushUndo();
    updMap((m) => ({ ...removeNodesFromMap(m, ids), ts: new Date().toISOString() }));
    setSel(new Set());
    setEditId(null);
  }

  function deleteEdgeFn(id: string) {
    pushUndo();
    updMap((m) => removeEdgeFromMap(m, id));
  }

  function updateEdgeStyle(id: string, style: EdgeStyle) {
    pushUndo();
    updMap((m) => ({ ...m, edges: m.edges.map((e) => (e.id === id ? { ...e, style } : e)) }));
  }

  function updateNodeFn(id: string, patch: Partial<MNode>) {
    updMap((m) => updateNodeInMap(m, id, patch));
  }

  function duplicateSel() {
    if (sel.size === 0) return;
    const copied = copyMapSelection(map, sel);
    if (!copied) return;
    pushUndo();
    const result = pasteMapSelection(map, copied, 60, 60);
    updMap(() => result.map);
    setSel(new Set(result.nodeIds));
  }

  // ── Copy / Paste ─────────────────────────────────────
  function copySel() {
    if (sel.size === 0) return;
    setClipboard(copyMapSelection(map, sel));
  }

  function copyNodesToMap(targetMapId: string) {
    if (sel.size === 0) return;
    const nodesToCopy = map.nodes.filter((n) => sel.has(n.id));
    setWs((w) => ({
      ...w,
      maps: w.maps.map((m) => {
        if (m.id !== targetMapId) return m;
        const idMap = new Map<string, string>();
        const newNodes: MNode[] = nodesToCopy.map((n) => {
          const nid = uid("n");
          idMap.set(n.id, nid);
          return { ...n, id: nid };
        });
        // Copia todas as edges onde AMBOS source e target estão entre os nós copiados
        const newEdges: MEdge[] = map.edges
          .filter((e) => idMap.has(e.source) && idMap.has(e.target))
          .map((e) => mkEdge(idMap.get(e.source)!, idMap.get(e.target)!, e.style));
        return { ...m, nodes: [...m.nodes, ...newNodes], edges: [...m.edges, ...newEdges] };
      }),
    }));
  }

  function pasteSel() {
    if (!clipboard || clipboard.nodes.length === 0) return;
    pushUndo();
    const result = pasteMapSelection(map, clipboard);
    updMap(() => result.map);
    setSel(new Set(result.nodeIds));
  }

  // ── Attachments ──────────────────────────────────────
  function addAttachment(nodeId: string, type: Attachment["type"]) {
    // Abre modal de inserção
    setAttachModal({ nodeId, type });
  }

  function confirmAttach(path: string, name: string) {
    if (!attachModal) return;
    const storedPath = attachModal.type === "url" ? (normalizeSchemeLessWebAddress(path) ?? path) : path;
    const existing = nodeMap.get(attachModal.nodeId)?.attachments ?? [];
    if (existing.some((item) => normalizeReferenceKey(item.path) === normalizeReferenceKey(storedPath))) {
      window.alert("Este destino já está anexado a este nó.");
      return;
    }
    pushUndo();
    const att: Attachment = {
      id: uid("att"),
      type: attachModal.type,
      name: name || storedPath.split(/[\\/]/).pop() || "Arquivo",
      path: storedPath,
    };
    updateNodeFn(attachModal.nodeId, {
      attachments: [...(nodeMap.get(attachModal.nodeId)?.attachments || []), att],
    });
    setAttachModal(null);
  }

  function removeAttachment(nodeId: string, attId: string) {
    pushUndo();
    const n = nodeMap.get(nodeId);
    if (!n) return;
    updateNodeFn(nodeId, { attachments: n.attachments?.filter((a) => a.id !== attId) || [] });
  }

  async function openAttach(att: Attachment) {
    await openAttachment(att, {
      workspace: ws,
      switchMap,
      alert: (message) => window.alert(message),
      confirm: (message) => window.confirm(message),
      tauri: (window as any).__TAURI__,
      openBrowserUrl: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
    });
  }
  // Link de nota Markdown: usa o mesmo caminho validado dos anexos.
  function openNoteLink(url: string) {
    void openAttach({ id: `link-${Date.now()}`, type: "url", name: url, path: url });
  }
  // Modal de anexos por nó (clicar no ícone do nó)
  const [nodeAttachModal, setNodeAttachModal] = useState<string | null>(null);

  // Modal de inserção
  const [attachModal, setAttachModal] = useState<{ nodeId: string; type: Attachment["type"] } | null>(null);
  const [attachPath, setAttachPath] = useState("");
  const [attachName, setAttachName] = useState("");

  // ── Canvas helpers ───────────────────────────────────
  function screenToWorld(sx: number, sy: number) {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const v = vpRef.current;
    return { x: (sx - r.left - v.x) / v.zoom, y: (sy - r.top - v.y) / v.zoom };
  }

  function fitView() {
    const w = wsRef.current;
    const m = w.maps.find((x) => x.id === w.active) ?? w.maps[0];
    const ns = m.nodes.filter((n) => isVisible(n.id));
    if (ns.length === 0) return;
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    const pad = 120;
    const xs = ns.map((n) => n.x),
      ys = ns.map((n) => n.y);
    const minX = Math.min(...xs) - 130,
      maxX = Math.max(...xs) + 130;
    const minY = Math.min(...ys) - 70,
      maxY = Math.max(...ys) + 70;
    const z = clamp(
      Math.min((r.width - pad * 2) / Math.max(1, maxX - minX), (r.height - pad * 2) / Math.max(1, maxY - minY)),
      0.2,
      1.5,
    );
    setVp({ x: r.width / 2 - ((minX + maxX) / 2) * z, y: r.height / 2 - ((minY + maxY) / 2) * z, zoom: z });
  }

  // ── Import / Export UI ───────────────────────────────
  async function handleImport(file: File) {
    const fail = (message: string) => alert(`Falha ao importar "${file.name}":\n\n${message}`);
    const succeed = (map: MMap) => {
      setWs((w) => {
        const next = { active: map.id, maps: [...w.maps, map] };
        void saveWs(next);
        return next;
      });
      setSel(new Set());
      setShowImport(false);
    };

    const result = await importFile(file);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    if (result.kind === "backup") {
      if (!confirm(`Este arquivo contém ${result.maps.length} mapa(s). Deseja importar todos?`)) return;
      setWs((w) => {
        const next = { active: result.maps[0].id, maps: [...w.maps, ...result.maps] };
        void saveWs(next);
        return next;
      });
      setShowImport(false);
      return;
    }
    succeed(result.map);
  }

  // ── Map management ───────────────────────────────────
  function openCreateModal() {
    setDraftTitle(`Novo mapa ${ws.maps.length + 1}`);
    setDraftTpl("Modelo A");
    setShowModal(true);
  }

  function confirmCreate() {
    const m = createMap(draftTitle.trim() || `Novo mapa ${ws.maps.length + 1}`, draftTpl);
    const newWs = { active: m.id, maps: [...ws.maps, m] };
    setWs(() => newWs);
    void saveWs(newWs).then((result) => {
      if (result.quotaExceeded) setShowStorageFull(true);
    });
    setSel(new Set());
    setShowModal(false);
    setHistory(createMapHistory());
    setCollapsed(new Set());
  }

  function switchMap(id: string) {
    setWs((w) => ({ ...w, active: id }));
    const target = ws.maps.find((m) => m.id === id);
    setSel(new Set());
    setEditId(null);
    setCollapsed(new Set(target?.collapsedIds ?? []));
    setHistory(createMapHistory());
  }

  function deleteMap(id: string) {
    const current = wsRef.current;
    const target = current.maps.find((m) => m.id === id);
    if (!target) return;
    const references = countMapReferences(current.maps, id);
    const referenceWarning =
      references > 0 ? `\n\nAtenção: ${references} link(s) em outros mapas apontam para ele e ficarão quebrados.` : "";
    if (
      !window.confirm(
        `Excluir o mapa "${target.title}"? A exclusão de um mapa não pode ser desfeita.${referenceWarning}`,
      )
    )
      return;
    const wasActive = current.active === id;
    const newWs = removeMapFromWorkspace(current, id);
    if (newWs === current) return;
    setWs(newWs);
    void saveWs(newWs).then((result) => {
      if (result.quotaExceeded) setShowStorageFull(true);
    });
    if (wasActive) {
      setSel(new Set());
      setEditId(null);
      setHistory(createMapHistory());
      setCollapsed(new Set(newWs.maps.find((m) => m.id === newWs.active)?.collapsedIds ?? []));
    }
  }

  // ── Wheel zoom ───────────────────────────────────────
  useEffect(() => {
    if (!canvasEl) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const v = vpRef.current;
      const r = canvasEl.getBoundingClientRect();
      const mx = e.clientX - r.left,
        my = e.clientY - r.top;
      const f = e.deltaY > 0 ? 0.92 : 1.08;
      const z = clamp(v.zoom * f, 0.1, 5);
      setVp({ x: mx - (mx - v.x) * (z / v.zoom), y: my - (my - v.y) * (z / v.zoom), zoom: z });
    };
    canvasEl.addEventListener("wheel", handler, { passive: false });
    return () => canvasEl.removeEventListener("wheel", handler);
  }, [canvasEl]);

  // rAF throttle para drag/pan: evita setWs em cada pixel de mousemove
  const rafId = useRef<number | null>(null);
  const rafEvent = useRef<MouseEvent | null>(null);
  function applyDragFrame() {
    rafId.current = null;
    const e = rafEvent.current;
    if (!e) return;
    const d = dragRef.current;
    if (!d) return;
    if (d.type === "pan") {
      setVp((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    } else if (d.type === "drag") {
      const r = canvasRef.current!.getBoundingClientRect();
      const v = vpRef.current;
      const wx = (e.clientX - r.left - v.x) / v.zoom;
      const wy = (e.clientY - r.top - v.y) / v.zoom;
      const nx = wx + d.ox,
        ny = wy + d.oy;
      const orig = d.initials.get(d.nodeId)!;
      const ddx = nx - orig.x,
        ddy = ny - orig.y;
      setWs((w) => ({
        ...w,
        maps: w.maps.map((m) =>
          m.id === w.active
            ? {
                ...m,
                nodes: m.nodes.map((n) => {
                  const ip = d.initials.get(n.id);
                  return ip ? { ...n, x: ip.x + ddx, y: ip.y + ddy } : n;
                }),
              }
            : m,
        ),
      }));
    }
  }

  // ── Global mouse move/up ─────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      // lasso e connect sao baratos, atualizam inline
      if (d.type === "lasso") {
        const updated = { ...d, ex: e.clientX, ey: e.clientY };
        dragRef.current = updated;
        setLassoRect({ sx: updated.sx, sy: updated.sy, ex: updated.ex, ey: updated.ey });
        return;
      }
      if (d.type === "connect") {
        setConnectLine({ sourceId: d.sourceId, mx: e.clientX, my: e.clientY });
        return;
      }
      // pan e drag: throttle via rAF para evitar setWs/setVp por pixel
      if (d.type === "pan" || d.type === "drag") {
        if (d.type === "drag" && !d.saved) {
          d.saved = true;
          const w = wsRef.current;
          const m = w.maps.find((x) => x.id === w.active);
          if (!m) {
            dragRef.current = null;
            return;
          }
          recordHistory(m);
        }
        rafEvent.current = e;
        if (rafId.current == null) {
          rafId.current = requestAnimationFrame(applyDragFrame);
        }
      }
    }
    function onUp(e: MouseEvent) {
      // Flush frame pendente do drag para posicao final antes de descartar
      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
        rafEvent.current = e;
        applyDragFrame();
      }
      const d = dragRef.current;
      if (d?.type === "lasso") {
        const r = canvasRef.current?.getBoundingClientRect();
        if (r) {
          const v = vpRef.current;
          const x1 = (Math.min(d.sx, d.ex) - r.left - v.x) / v.zoom;
          const y1 = (Math.min(d.sy, d.ey) - r.top - v.y) / v.zoom;
          const x2 = (Math.max(d.sx, d.ex) - r.left - v.x) / v.zoom;
          const y2 = (Math.max(d.sy, d.ey) - r.top - v.y) / v.zoom;
          const w = wsRef.current;
          const m = w.maps.find((x) => x.id === w.active);
          if (!m) {
            setLassoRect(null);
            dragRef.current = null;
            return;
          }
          const inside = new Set(
            m.nodes.filter((n) => n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2).map((n) => n.id),
          );
          if (inside.size > 0) setSel(inside);
        }
        setLassoRect(null);
        dragRef.current = null;
        setCursor("grab");
        document.body.style.cursor = "";
        return;
      }
      if (d?.type === "connect") {
        const r = canvasRef.current?.getBoundingClientRect();
        if (r) {
          const v = vpRef.current;
          const wx = (e.clientX - r.left - v.x) / v.zoom;
          const wy = (e.clientY - r.top - v.y) / v.zoom;
          const w = wsRef.current;
          const m = w.maps.find((x) => x.id === w.active);
          if (!m) {
            dragRef.current = null;
            return;
          }
          const target = m.nodes.find((n) => Math.abs(n.x - wx) < 85 && Math.abs(n.y - wy) < 40);
          if (target && target.id !== d.sourceId) {
            const exists = m.edges.some(
              (e) =>
                (e.source === d.sourceId && e.target === target.id) ||
                (e.source === target.id && e.target === d.sourceId),
            );
            if (!exists) {
              recordHistory(m);
              setWs((w) => ({
                ...w,
                maps: w.maps.map((mp) =>
                  mp.id === w.active ? { ...mp, edges: [...mp.edges, mkEdge(d.sourceId, target.id)] } : mp,
                ),
              }));
            }
          }
        }
        setConnectLine(null);
      }
      dragRef.current = null;
      setCursor("grab");
      document.body.style.cursor = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────
  // O listener é registrado uma única vez, mas sempre chama o handler do render
  // atual (via ref). Sem isso, as closures ficavam presas ao primeiro render e
  // Ctrl+Z/C/V/D e Esc operavam sobre estado vazio/antigo.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const s = selRef.current;
        if (s.size > 0) {
          const w = wsRef.current;
          const m = w.maps.find((x) => x.id === w.active);
          if (!m) return;
          recordHistory(m);
          setWs((w) => ({
            ...w,
            maps: w.maps.map((mp) =>
              mp.id === w.active ? { ...removeNodesFromMap(mp, s), ts: new Date().toISOString() } : mp,
            ),
          }));
          setSel(new Set());
          setEditId(null);
        }
      }
      if (e.key === "Escape") {
        // Modais têm prioridade — fecha qualquer modal aberto antes
        const anyModalOpen = !!(
          showModal ||
          showExport ||
          showImport ||
          showNotesModal ||
          showChecklistModal ||
          showLayoutModal ||
          showBgPanel ||
          attachModal ||
          nodeAttachModal ||
          ctx
        );
        if (anyModalOpen) {
          setShowModal(false);
          setShowExport(false);
          setShowImport(false);
          setShowNotesModal(false);
          setShowChecklistModal(false);
          setShowLayoutModal(false);
          setShowBgPanel(false);
          setAttachModal(null);
          setNodeAttachModal(null);
          setCtx(null);
          return;
        }
        setSel(new Set());
        setEditId(null);
        setCtx(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSel(new Set(map.nodes.map((n) => n.id)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        duplicateSel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        copySel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        pasteSel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        if (sel.size === 1) addAttachment([...sel][0], "url");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        if (sel.size === 1) {
          const n = nodeMap.get([...sel][0]);
          setNotesEditMode(!n?.markdown);
          setShowNotesModal(true);
        }
      }
      if (e.key === "f" && !e.ctrlKey && !e.metaKey) fitView();
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen((s) => !s);
        setSearchQuery("");
        setSearchIdx(0);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        e.preventDefault();
        if (selRef.current.size === 1) setInspectorOpen((s) => !s);
      }
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Canvas handlers ──────────────────────────────────
  function onCanvasDown(e: React.MouseEvent) {
    if (e.button !== 0 || e.target !== canvasRef.current) return;
    setCtx(null);
    setEditId(null);
    // Alt+drag ou drag normal no fundo = pan; Shift+drag = lasso
    if (e.shiftKey) {
      dragRef.current = { type: "lasso", sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY };
      setLassoRect({ sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY });
      setCursor("default");
      document.body.style.cursor = "default";
    } else {
      setSel(new Set());
      setInspectorOpen(false);
      const v = vpRef.current;
      dragRef.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      setCursor("grabbing");
      document.body.style.cursor = "grabbing";
    }
  }
  function onCanvasDblClick(e: React.MouseEvent) {
    if (e.target !== canvasRef.current) return;
    const w = screenToWorld(e.clientX, e.clientY);
    addNodeAt(w.x, w.y);
  }
  function onCanvasCtx(e: React.MouseEvent) {
    e.preventDefault();
    if (e.target !== canvasRef.current) return;
    const w = screenToWorld(e.clientX, e.clientY);
    setCtx({ x: e.clientX, y: e.clientY, wx: w.x, wy: w.y });
  }
  function onNodeDown(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (e.button !== 0) return;
    setCtx(null);
    setEditId(null);
    const w = screenToWorld(e.clientX, e.clientY);
    const n = nodeMap.get(id)!;
    let newSel: Set<string>;
    if (e.shiftKey) {
      newSel = new Set(sel);
      if (newSel.has(id)) {
        newSel.delete(id);
      } else {
        newSel.add(id);
      }
    } else if (!sel.has(id)) {
      newSel = new Set([id]);
      setInspectorOpen(false);
    } else newSel = sel;
    setSel(newSel);
    const effectiveSel = newSel.has(id) ? newSel : new Set([id]);
    const initials = new Map<string, { x: number; y: number }>();
    map.nodes.forEach((nd) => {
      if (effectiveSel.has(nd.id)) initials.set(nd.id, { x: nd.x, y: nd.y });
    });
    dragRef.current = { type: "drag", nodeId: id, ox: n.x - w.x, oy: n.y - w.y, initials, saved: false };
    setCursor("grabbing");
    document.body.style.cursor = "grabbing";
  }
  function onHandleDown(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { type: "connect", sourceId: id };
    setCursor("crosshair");
    document.body.style.cursor = "crosshair";
  }
  function onNodeDblClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSel(new Set([id]));
    setInspectorOpen(true);
  }
  function onNodeClick(e: React.MouseEvent, id: string) {
    if (e.shiftKey) return;
    setSel(new Set([id]));
  }
  function onNodeCtx(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    // Preserva seleção múltipla; adiciona o nó clicado se não estava selecionado
    setSel((s) => (s.has(id) ? s : new Set([id])));
    setCtx({ x: e.clientX, y: e.clientY, nodeId: id });
  }
  function onEdgeCtx(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, edgeId: id });
  }

  // ── Minimap ──────────────────────────────────────────
  const mmBounds = useMemo(() => {
    const vis = map.nodes.filter((n) => visibleSet.has(n.id));
    if (vis.length === 0) return null;
    const xs = vis.map((n) => n.x),
      ys = vis.map((n) => n.y);
    return {
      minX: Math.min(...xs) - 60,
      maxX: Math.max(...xs) + 60,
      minY: Math.min(...ys) - 40,
      maxY: Math.max(...ys) + 40,
    };
  }, [map.nodes, visibleSet]);

  // ════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════

  if (closeProtectionStatus !== "ready")
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <section className="w-full max-w-xl rounded-2xl border border-indigo-400/30 bg-slate-900 p-8 shadow-2xl">
          {closeProtectionStatus === "initializing" ? (
            <div role="status" aria-live="polite" aria-busy="true">
              <h1 className="text-lg font-semibold">Preparando proteção de fechamento...</h1>
              <p className="mt-3 text-sm text-slate-300">
                A interface de edição será liberada após a confirmação da proteção.
              </p>
            </div>
          ) : (
            <div role="alert" aria-live="assertive">
              <h1 className="text-lg font-semibold text-rose-300">Não foi possível ativar a proteção de fechamento</h1>
              <p className="mt-3 text-sm text-slate-300">
                O aplicativo permanece bloqueado para proteger seus dados. Verifique a inicialização e tente novamente.
              </p>
              {closeProtectionError && (
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-400">
                  {closeProtectionError}
                </pre>
              )}
              <button
                type="button"
                onClick={() => retryCloseProtectionRef.current()}
                className="mt-5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Tentar novamente
              </button>
            </div>
          )}
        </section>
      </main>
    );

  if (conflict)
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <RecoveryDialog
          conflict={conflict}
          busy={recoveryBusy}
          onUseFile={() => void applyFileCopy()}
          onUseLocal={() => void applyLocalCopy()}
          onExport={exportRecovery}
          onCloseUnchanged={closeWithoutChanges}
        />
        <CloseFailureDialog
          open={closeDialogOpen}
          saving={closeSaving}
          error={closeError}
          failureStage={closeFailureStage}
          onRetry={() => closeGuardRef.current?.retry()}
          onCancel={() => {
            setCloseDialogOpen(false);
            setCloseError(null);
          }}
        />
        <CloseSavingNotice open={closeSaving} slow={closeSaveSlow} />
      </main>
    );

  if (!bootReady && !bootIssue)
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <p className="text-sm text-slate-400">Verificando as cópias dos mapas mentais…</p>
        <CloseFailureDialog
          open={closeDialogOpen}
          saving={closeSaving}
          error={closeError}
          failureStage={closeFailureStage}
          onRetry={() => closeGuardRef.current?.retry()}
          onCancel={() => {
            setCloseDialogOpen(false);
            setCloseError(null);
          }}
        />
        <CloseSavingNotice open={closeSaving} slow={closeSaveSlow} />
      </main>
    );

  if (bootIssue)
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <section className="max-w-2xl rounded-2xl border border-amber-500/30 bg-slate-900 p-8 shadow-2xl">
          <h1 className="text-xl font-semibold text-amber-300">Os dados precisam de recuperação</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            O APAMIND encontrou uma cópia inválida ou divergente. Para proteger seus mapas, não carregou um workspace
            vazio e suspendeu os salvamentos automáticos. As cópias originais permanecem nos respectivos armazenamentos.
          </p>
          <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs text-slate-400">
            {bootIssue}
          </pre>
          <p className="mt-4 text-sm text-slate-400">
            Feche o aplicativo sem editar os dados e preserve uma cópia dos arquivos de armazenamento antes de qualquer
            recuperação manual.
          </p>
        </section>
        <CloseFailureDialog
          open={closeDialogOpen}
          saving={closeSaving}
          error={closeError}
          failureStage={closeFailureStage}
          onRetry={() => closeGuardRef.current?.retry()}
          onCancel={() => {
            setCloseDialogOpen(false);
            setCloseError(null);
          }}
        />
        <CloseSavingNotice open={closeSaving} slow={closeSaveSlow} />
      </main>
    );

  return (
    <main
      className={`min-h-screen overflow-hidden font-sans transition-colors duration-300 ${bg}`}
      style={{ backgroundColor: isDark ? background.baseDark : background.baseLight }}
    >
      {/* ── Animated background layer ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className={`absolute inset-0 ${background.animated ? "bg-anim" : ""}`}
          style={{
            background:
              `radial-gradient(ellipse at 20% 20%, ${background.glowA}, transparent 50%), ` +
              `radial-gradient(ellipse at 80% 75%, ${background.glowB}, transparent 48%), ` +
              (background.glowC ? `radial-gradient(ellipse at 60% 10%, ${background.glowC}, transparent 44%), ` : "") +
              (background.glowD ? `radial-gradient(ellipse at 10% 80%, ${background.glowD}, transparent 40%), ` : "") +
              "transparent",
          }}
        />
        {/* Pattern overlay */}
        {background.pattern && background.pattern !== "none" && (
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: PATTERN_CSS[background.pattern],
              backgroundSize: PATTERN_SIZES[background.pattern],
            }}
          />
        )}
      </div>

      <div className="relative flex min-h-screen">
        {/* ─── SIDEBAR ──────────────────────────────── */}
        {sidebarOpen && (
          <aside className={`hidden lg:flex w-72 shrink-0 flex-col border-r ${panel}`}>
            {/* Logo */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 shadow-lg shadow-indigo-500/25 flex items-center justify-center text-lg font-bold text-white">
                A
              </div>
              <div>
                <p className="text-sm font-bold tracking-widest text-indigo-300">APAMIND</p>
                <p className="text-xs text-slate-500">Editor de mapas mentais</p>
              </div>
            </div>

            <div className={`mx-5 h-px ${isDark ? "bg-white/6" : "bg-black/6"}`} />

            {/* Novo mapa */}
            <div className="px-4 mt-4">
              <button
                onClick={openCreateModal}
                className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:opacity-90 transition"
              >
                + Novo mapa
              </button>
            </div>

            {/* Meus mapas */}
            <div className="px-4 mt-5 flex-1 min-h-0">
              <p
                className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}
              >
                Meus mapas ({ws.maps.length})
              </p>
              <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1 custom-scroll">
                {ws.maps.map((m) => (
                  <div
                    key={m.id}
                    className={`group flex items-center rounded-xl px-3 py-2 text-sm cursor-pointer transition ${m.id === map.id ? "bg-indigo-500/90 text-white shadow" : isDark ? "text-slate-300 hover:bg-white/5" : "text-slate-600 hover:bg-black/5"}`}
                  >
                    <button onClick={() => switchMap(m.id)} className="flex-1 text-left truncate text-[13px]">
                      {m.title}
                    </button>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        deleteMap(m.id);
                      }}
                      className="opacity-0 group-hover:opacity-50 hover:!opacity-100 ml-1 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className={`mx-5 mt-4 h-px ${isDark ? "bg-white/6" : "bg-black/6"}`} />

            {/* Atalhos */}
            <div className="px-4 mt-4 pb-5">
              <p
                className={`text-[11px] font-semibold uppercase tracking-widest mb-2.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}
              >
                Atalhos
              </p>
              <div
                className={`text-[12px] space-y-1.5 leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}
              >
                <p>
                  <b>Shift+arrastar</b> fundo → selecionar grupo
                </p>
                <p>
                  <b>Clique</b> nó → selecionar · <b>Duplo clique</b> → Inspetor
                </p>
                <p>
                  <b>Ctrl+I</b> → abrir/fechar Inspetor · <b>Ctrl+N</b> → notas
                </p>
                <p>
                  <b>Botão direito</b> → menu de contexto
                </p>
                <p>
                  <b>Scroll</b> → zoom · <b>Arrastar fundo</b> → pan
                </p>
                <p>
                  <b>Ctrl+C/V</b> → copiar/colar · <b>Ctrl+Z</b> → desfazer
                </p>
                <p>
                  <b>Ctrl+A</b> → selecionar tudo · <b>Ctrl+N</b> → notas
                </p>
                <p>
                  <b>Delete</b> → excluir · <b>F</b> → ajustar zoom
                </p>
              </div>
            </div>
          </aside>
        )}

        {/* ─── MAIN AREA ────────────────────────────── */}
        <section className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          {/* z-20: o backdrop-blur do painel cria stacking context; sem um z-index
              explícito o canvas (posicionado, depois no DOM) fica por cima e engole
              os cliques do popup de busca que transborda o header. */}
          <header
            className={`relative z-20 flex h-14 items-center justify-between border-b px-3 md:px-5 gap-2 ${panel}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setSidebarOpen((s) => !s)}
                className={`hidden lg:block rounded-xl border px-2 py-1.5 text-xs ${btn}`}
                title="Recolher menu"
                aria-label="Alternar barra lateral"
              >
                ☰
              </button>
              <button onClick={openCreateModal} className={`lg:hidden rounded-xl border px-3 py-1.5 text-xs ${btn}`}>
                + Novo
              </button>
              <div className="hidden md:block min-w-0">
                {editingMapTitle ? (
                  <input
                    autoFocus
                    value={mapTitleDraft}
                    onChange={(ev) => setMapTitleDraft(ev.target.value)}
                    onBlur={() => {
                      if (mapTitleDraft.trim()) {
                        updMap((m) => ({ ...m, title: mapTitleDraft.trim() }));
                      }
                      setEditingMapTitle(false);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        if (mapTitleDraft.trim()) updMap((m) => ({ ...m, title: mapTitleDraft.trim() }));
                        setEditingMapTitle(false);
                      }
                      if (ev.key === "Escape") setEditingMapTitle(false);
                    }}
                    className={`w-full rounded-lg border px-2 py-1 text-sm font-semibold outline-none ${inp}`}
                  />
                ) : (
                  <h1
                    className="text-sm font-semibold truncate cursor-pointer hover:opacity-70"
                    onClick={() => {
                      setMapTitleDraft(map.title);
                      setEditingMapTitle(true);
                    }}
                    title="Clique para renomear"
                  >
                    {map.title} ✎
                  </h1>
                )}
                <p className="text-xs text-slate-500">
                  {map.template} · {map.nodes.length} nós
                </p>
                <p
                  aria-live="polite"
                  className={`text-xs mt-1 ${saveStatus === "error" ? "text-red-400" : saveStatus === "saving" ? "text-amber-400" : "text-emerald-500"}`}
                >
                  {saveStatus === "saving" ? "Salvando…" : saveStatus === "error" ? "Erro ao salvar" : "Salvo"}
                </p>
                {saveError && (
                  <p role="alert" className="text-xs text-red-400 mt-1">
                    {saveError}
                  </p>
                )}
                {showStorageFull && (
                  <p className="text-xs text-red-500 mt-1">
                    Armazenamento local cheio! Algumas mudanças podem não ter sido salvas. Exporte um backup e remova
                    mapas antigos.
                  </p>
                )}
                {brokenLinks.length > 0 && (
                  <p role="status" className="text-xs text-amber-400 mt-1">
                    {brokenLinks.length === 1
                      ? "1 link para outro mapa está quebrado (o mapa foi excluído ou não foi importado)."
                      : `${brokenLinks.length} links para outros mapas estão quebrados.`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowLayoutModal(true)}
                className={`hidden md:block rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 px-2.5 py-1.5 text-xs transition`}
                title="Auto-organizar"
              >
                🪄 Organizar
              </button>
              <span className={`hidden sm:block w-px h-6 mx-1 ${isDark ? "bg-white/10" : "bg-black/10"}`} />
              <button
                onClick={focusOnSelected}
                disabled={!selected}
                className={`rounded-lg border px-2 py-1.5 text-xs disabled:opacity-30 ${btn}`}
                title="Focar nó selecionado (selecione um nó primeiro)"
                aria-label="Focar nó selecionado (selecione um nó primeiro)"
              >
                🔍
              </button>
              <div className="relative">
                <button
                  onClick={() => {
                    setSearchOpen((s) => !s);
                    setSearchQuery("");
                    setSearchIdx(0);
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-xs ${btn} ${searchOpen ? "border-indigo-400 bg-indigo-500/15 text-indigo-300" : ""}`}
                  title="Buscar nós (Ctrl+F)"
                >
                  Search
                </button>
                {searchOpen && (
                  <div
                    role="dialog"
                    aria-label="Busca de nós"
                    className={`absolute right-0 top-full mt-1 z-50 rounded-2xl border shadow-2xl p-3 flex flex-col gap-2 ${isDark ? "border-white/10 bg-slate-900/95 backdrop-blur-xl" : "border-black/10 bg-white/95 backdrop-blur-xl"}`}
                    style={{ width: 280 }}
                    onMouseDown={(ev) => ev.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={searchQuery}
                        onChange={(ev) => {
                          setSearchQuery(ev.target.value);
                          setSearchIdx(0);
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === "Escape") {
                            setSearchOpen(false);
                            setSearchQuery("");
                          }
                          if (ev.key === "Enter" && searchResults.length > 0) {
                            const next = (searchIdx + 1) % searchResults.length;
                            setSearchIdx(next);
                            setSel(new Set([searchResults[next].id]));
                            setInspectorOpen(false);
                            const r = canvasRef.current?.getBoundingClientRect();
                            if (r)
                              setVp({
                                x: r.width / 2 - searchResults[next].x * 1.2,
                                y: r.height / 2 - searchResults[next].y * 1.2,
                                zoom: 1.2,
                              });
                          }
                        }}
                        placeholder="Buscar nos nós…"
                        className={`flex-1 rounded-xl border px-3 py-1.5 text-sm outline-none ${inp}`}
                      />
                      <button
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                        }}
                        onClick={() => {
                          setSearchOpen(false);
                          setSearchQuery("");
                          setSearchIdx(0);
                        }}
                        className={`rounded-lg border px-2 py-1.5 text-xs ${btn}`}
                      >
                        ✕
                      </button>
                    </div>
                    {searchQuery.trim() && (
                      <div className="max-h-52 overflow-y-auto custom-scroll space-y-0.5">
                        {searchResults.length === 0 ? (
                          <p className="text-xs text-slate-500 px-2 py-1">Nenhum resultado</p>
                        ) : (
                          searchResults.map((n, i) => (
                            <button
                              key={n.id}
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                              }}
                              onClick={() => {
                                setSel(new Set([n.id]));
                                setInspectorOpen(false);
                                const r = canvasRef.current?.getBoundingClientRect();
                                if (r) setVp({ x: r.width / 2 - n.x * 1.2, y: r.height / 2 - n.y * 1.2, zoom: 1.2 });
                                setSearchOpen(false);
                                setSearchQuery("");
                                setSearchIdx(0);
                              }}
                              className={`w-full text-left rounded-xl px-3 py-2 text-sm transition ${
                                i === searchIdx
                                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                  : isDark
                                    ? "hover:bg-white/5 text-slate-300"
                                    : "hover:bg-slate-100 text-slate-700"
                              }`}
                            >
                              <span className="font-medium truncate block">
                                {n.icon && <span className="mr-1">{n.icon}</span>}
                                {n.title}
                              </span>
                              {n.note && <span className="text-xs opacity-60 truncate block">{n.note}</span>}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    {searchResults.length > 1 && (
                      <p className="text-[11px] text-slate-500 text-center">
                        {searchIdx + 1} de {searchResults.length} — Enter para próximo
                      </p>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={undo}
                disabled={past.length === 0}
                className={`rounded-lg border px-2 py-1.5 text-xs disabled:opacity-30 ${btn}`}
                title="Desfazer"
                aria-label="Desfazer"
              >
                ↶
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                className={`rounded-lg border px-2 py-1.5 text-xs disabled:opacity-30 ${btn}`}
                title="Refazer"
                aria-label="Refazer"
              >
                ↷
              </button>
              <span className={`hidden sm:block w-px h-6 ${isDark ? "bg-white/10" : "bg-black/10"}`} />
              <button
                onClick={() => setVp((v) => ({ ...v, zoom: clamp(v.zoom * 0.85, 0.1, 5) }))}
                className={`rounded-lg border px-2 py-1.5 text-xs ${btn}`}
                aria-label="Diminuir zoom"
              >
                −
              </button>
              <span data-testid="zoom-level" className="text-xs w-12 text-center tabular-nums">
                {Math.round(vp.zoom * 100)}%
              </span>
              <button
                onClick={() => setVp((v) => ({ ...v, zoom: clamp(v.zoom * 1.15, 0.1, 5) }))}
                className={`rounded-lg border px-2 py-1.5 text-xs ${btn}`}
                aria-label="Aumentar zoom"
              >
                +
              </button>
              <button
                onClick={fitView}
                className={`rounded-lg border px-2 py-1.5 text-xs ${btn}`}
                title="Ajustar (F)"
                aria-label="Ajustar (F)"
              >
                ⊞
              </button>
              <span className={`hidden sm:block w-px h-6 ${isDark ? "bg-white/10" : "bg-black/10"}`} />
              <button
                onClick={() => setShowImport(true)}
                className={`hidden sm:block rounded-lg border px-2.5 py-1.5 text-xs ${btn}`}
                aria-label="Importar"
              >
                Importar
              </button>
              <button
                onClick={() => setShowExport(true)}
                className={`hidden sm:block rounded-lg border px-2.5 py-1.5 text-xs ${btn}`}
                aria-label="Exportar"
              >
                Exportar
              </button>
              <button
                onClick={() => setShowBgPanel(true)}
                className={`hidden sm:block rounded-lg border px-2.5 py-1.5 text-xs ${btn}`}
                aria-label="Painel de fundo"
              >
                🎨 Fundo
              </button>
              <button
                onClick={() => setSidebarOpen((s) => !s)}
                className={`hidden lg:block rounded-lg border px-2.5 py-1.5 text-xs ${btn}`}
                title="Ocultar/mostrar painel"
                aria-label="Alternar barra lateral"
              >
                {sidebarOpen ? "◀ Ocultar" : "▶ Painel"}
              </button>
              <button
                onClick={() => setIsDark((d) => !d)}
                className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1.5 text-xs font-medium text-white shadow shadow-indigo-500/20"
                aria-label="Alternar tema claro/escuro"
              >
                {isDark ? "☀️" : "🌙"}
              </button>
            </div>
          </header>

          {/* ─── CANVAS ─────────────────────────────── */}
          <div
            ref={setCanvasNode}
            data-testid="canvas"
            className="flex-1 relative overflow-hidden"
            style={{ cursor }}
            onMouseDown={onCanvasDown}
            onDoubleClick={onCanvasDblClick}
            onContextMenu={onCanvasCtx}
          >
            <div
              className={`absolute inset-0 pointer-events-none ${isDark ? "canvas-grid-dark" : "canvas-grid-light"}`}
            />
            {map.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-slate-500 text-sm">Clique duplo para criar o primeiro nó</p>
              </div>
            )}

            {/* Lasso selection rect */}
            {lassoRect &&
              (() => {
                const r = canvasRef.current?.getBoundingClientRect();
                if (!r) return null;
                const x = Math.min(lassoRect.sx, lassoRect.ex) - r.left;
                const y = Math.min(lassoRect.sy, lassoRect.ey) - r.top;
                const w = Math.abs(lassoRect.ex - lassoRect.sx);
                const h = Math.abs(lassoRect.ey - lassoRect.sy);
                return (
                  <div
                    className="absolute pointer-events-none z-30"
                    style={{
                      left: x,
                      top: y,
                      width: w,
                      height: h,
                      border: "1.5px dashed rgba(129,140,248,0.8)",
                      background: "rgba(99,102,241,0.08)",
                      borderRadius: 6,
                    }}
                  />
                );
              })()}

            <div
              style={{
                transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
                transformOrigin: "0 0",
                opacity: 1,
                transition: "opacity 0.22s ease-in",
              }}
            >
              {/* Edges SVG */}
              <svg style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible" }}>
                {map.edges.map((edge) => {
                  const s = nodeMap.get(edge.source);
                  const t = nodeMap.get(edge.target);
                  if (!s || !t) return null;
                  const hidden = collapsed.has(edge.source) || !isVisible(s.id) || !isVisible(t.id);
                  if (hidden) return null;
                  const d = edgePath(s.x, s.y, t.x, t.y);
                  const hi = hoveredEdge === edge.id;
                  const dash = edge.style === "dashed" ? "8 5" : edge.style === "dotted" ? "3 4" : undefined;
                  return (
                    <g key={edge.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke={hi ? edgeHi : edgeClr}
                        strokeWidth={hi ? 3 : 2}
                        strokeLinecap="round"
                        strokeDasharray={dash}
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ pointerEvents: "auto", cursor: "pointer" }}
                        onMouseEnter={() => setHoveredEdge(edge.id)}
                        onMouseLeave={() => setHoveredEdge(null)}
                        onContextMenu={(ev) => onEdgeCtx(ev, edge.id)}
                      />
                    </g>
                  );
                })}
                {connectLine &&
                  (() => {
                    const src = nodeMap.get(connectLine.sourceId);
                    if (!src) return null;
                    const r = canvasRef.current?.getBoundingClientRect();
                    if (!r) return null;
                    const ex = (connectLine.mx - r.left - vp.x) / vp.zoom;
                    const ey = (connectLine.my - r.top - vp.y) / vp.zoom;
                    return (
                      <line
                        x1={src.x}
                        y1={src.y}
                        x2={ex}
                        y2={ey}
                        stroke={isDark ? "rgba(129,140,248,0.7)" : "rgba(79,70,229,0.6)"}
                        strokeWidth={2.5}
                        strokeDasharray="8 5"
                        strokeLinecap="round"
                      />
                    );
                  })()}
              </svg>

              {/* Nodes */}
              {map.nodes.map((n) => {
                if (!isVisible(n.id)) return null;
                const isSel = sel.has(n.id);
                const isEdit = editId === n.id;
                const nHasKids = hasKids.has(n.id);
                const isCollapsed = collapsed.has(n.id);
                return (
                  <div
                    key={n.id}
                    className={`group absolute flex items-center gap-3 border p-3 shadow-xl transition-shadow select-none
                      ${shapeClass(n.shape)}
                      ${n.shape === "circle" ? "w-36 h-36 flex-col justify-center text-center !gap-1.5 !p-3" : "min-w-[10rem] max-w-[16rem]"}
                      ${
                        isSel
                          ? `border-indigo-400 shadow-indigo-500/25 ring-2 ring-indigo-400/25 z-10 ${isDark ? "bg-slate-900/90" : "bg-white/95"}`
                          : isDark
                            ? "border-white/12 bg-slate-900/80 shadow-black/20 hover:border-white/25 hover:shadow-lg"
                            : "border-slate-200 bg-white/90 shadow-slate-200/60 hover:border-slate-300 hover:shadow-lg"
                      }`}
                    style={{
                      left: n.x,
                      top: n.y,
                      transform: `translate(-50%, -50%) scale(${n.scale ?? 1})`,
                      cursor: cursor === "grabbing" ? "grabbing" : "grab",
                      ...(n.borderColor ? { borderColor: n.borderColor } : {}),
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`No: ${n.title}`}
                    onMouseDown={(ev) => onNodeDown(ev, n.id)}
                    onClick={(ev) => {
                      if (!dragRef.current) onNodeClick(ev, n.id);
                    }}
                    onDoubleClick={(ev) => onNodeDblClick(ev, n.id)}
                    onContextMenu={(ev) => onNodeCtx(ev, n.id)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setSel(new Set([n.id]));
                        setInspectorOpen(true);
                      } else if (ev.key === "Delete" || ev.key === "Backspace") {
                        ev.preventDefault();
                        const s = new Set<string>([n.id]);
                        const w = wsRef.current;
                        const m = w.maps.find((mp) => mp.id === w.active);
                        if (!m) return;
                        recordHistory(m);
                        setWs((w2) => ({
                          ...w2,
                          maps: w2.maps.map((mp) =>
                            mp.id === w2.active
                              ? {
                                  ...mp,
                                  nodes: mp.nodes.filter((x) => !s.has(x.id)),
                                  edges: mp.edges.filter((ed) => !s.has(ed.source) && !s.has(ed.target)),
                                }
                              : mp,
                          ),
                        }));
                        setSel(new Set());
                        setEditId(null);
                      }
                    }}
                  >
                    <div
                      className={`${n.shape === "circle" ? "h-8 w-8" : "h-10 w-10"} shrink-0 rounded-xl ${iconBg(n.tone, isDark)} shadow-md flex items-center justify-center text-lg emoji`}
                    >
                      {n.icon || ""}
                    </div>
                    <div className="min-w-0 flex-1">
                      {isEdit && editField === "title" ? (
                        <input
                          autoFocus
                          value={n.title}
                          onChange={(ev) => updateNodeFn(n.id, { title: ev.target.value })}
                          onBlur={() => setEditId(null)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === "Escape") setEditId(null);
                          }}
                          onClick={(ev) => ev.stopPropagation()}
                          className={`w-full rounded-lg border px-2 py-1 text-sm font-semibold outline-none ${inp}`}
                        />
                      ) : (
                        <div className="text-sm font-semibold truncate">{n.title}</div>
                      )}
                      {n.note && !isEdit && (
                        <div className={`text-xs mt-0.5 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {n.note}
                        </div>
                      )}
                      {n.checklist && n.checklist.length > 0 && !isEdit && (
                        <div className="mt-1 space-y-0.5">
                          {n.checklist.slice(0, 2).map((c, i) => (
                            <div key={i} className="flex items-center gap-1 text-[10px]">
                              <span className={c.done ? "text-emerald-400" : "text-slate-500"}>
                                {c.done ? "☑" : "☐"}
                              </span>
                              <span className={`truncate ${c.done ? "line-through opacity-50" : ""}`}>{c.text}</span>
                            </div>
                          ))}
                          {n.checklist.length > 2 && (
                            <span className="text-[10px] text-slate-500">+{n.checklist.length - 2} itens</span>
                          )}
                        </div>
                      )}
                      {n.attachments && n.attachments.length > 0 && !isEdit && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setNodeAttachModal(n.id);
                          }}
                          className={`mt-1 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition ${isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-black/5 bg-slate-50 hover:bg-slate-100"}`}
                          title={`${n.attachments.length} anexo(s). Clique para ver/abrir.`}
                        >
                          <span className="emoji">{ATTACH_ICONS[n.attachments[0].type]}</span>
                          {n.attachments.length > 1 && <span className="opacity-70">+{n.attachments.length - 1}</span>}
                        </button>
                      )}
                    </div>

                    {/* Collapse toggle (inline) */}
                    {nHasKids && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleCollapse(n.id);
                        }}
                        className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-[12px] font-bold z-20 transition-colors
                          ${isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-black/5 hover:bg-black/10 text-slate-700"}`}
                        aria-label="Colapsar ou expandir ramo"
                      >
                        {isCollapsed ? "+" : "−"}
                      </button>
                    )}

                    {/* Connection handles */}
                    {(["top", "right", "bottom", "left"] as const).map((pos) => (
                      <div
                        key={pos}
                        className={`absolute w-3.5 h-3.5 rounded-full border-2 opacity-0 group-hover:opacity-100 hover:!opacity-100 hover:scale-125 transition-all cursor-crosshair z-20
                          ${isDark ? "border-indigo-400 bg-slate-800" : "border-indigo-500 bg-white"}
                          ${pos === "top" ? "-top-[7px] left-1/2 -translate-x-1/2" : ""}
                          ${pos === "bottom" ? "-bottom-[7px] left-1/2 -translate-x-1/2" : ""}
                          ${pos === "left" ? "-left-[7px] top-1/2 -translate-y-1/2" : ""}
                          ${pos === "right" ? "-right-[7px] top-1/2 -translate-y-1/2" : ""}
                        `}
                        onMouseDown={(ev) => onHandleDown(ev, n.id)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Mini map */}
            {mmBounds && map.nodes.length > 0 && (
              <div
                className={`absolute bottom-4 left-4 rounded-2xl border hidden md:block overflow-hidden transition-all ${panel} ${minimapOpen ? "p-3" : "p-1.5"}`}
              >
                {minimapOpen ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-2 gap-6">
                      <span>Mapa</span>
                      <div className="flex items-center gap-3">
                        <span>{map.nodes.filter((n) => isVisible(n.id)).length} visíveis</span>
                        <button
                          onClick={() => setMinimapOpen(false)}
                          className="hover:text-slate-300"
                          aria-label="Fechar mini mapa"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div
                      className={`relative w-36 h-24 rounded-xl overflow-hidden ${isDark ? "bg-white/5" : "bg-slate-100"}`}
                    >
                      {map.nodes
                        .filter((n) => isVisible(n.id))
                        .map((n) => {
                          const rx = mmBounds.maxX - mmBounds.minX || 1;
                          const ry = mmBounds.maxY - mmBounds.minY || 1;
                          return (
                            <span
                              key={n.id}
                              className={`absolute w-3 h-2 rounded-sm bg-gradient-to-r ${TONES[n.tone % TONES.length]} ${sel.has(n.id) ? "ring-1 ring-white" : ""}`}
                              style={{
                                left: `${((n.x - mmBounds.minX) / rx) * 100}%`,
                                top: `${((n.y - mmBounds.minY) / ry) * 100}%`,
                                transform: "translate(-50%,-50%)",
                              }}
                            />
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => setMinimapOpen(true)}
                    className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 flex items-center gap-2"
                    aria-label="Abrir mini mapa"
                  >
                    <span>🗺️</span> Mapa
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ─── INSPECTOR ────────────────────────────── */}
        {selected && inspectorOpen && (
          <aside
            className={`hidden xl:flex w-80 shrink-0 flex-col border-l p-5 gap-4 overflow-y-auto custom-scroll ${panel}`}
          >
            <p className="text-xs uppercase tracking-[.2em] text-slate-500">Inspetor</p>

            <div>
              <label className="text-xs text-slate-500 block mb-1">Título</label>
              <input
                value={selected.title ?? ""}
                onFocus={pushUndo}
                onChange={(ev) => updateNodeFn(selected.id, { title: ev.target.value })}
                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${inp}`}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Nota curta</label>
              <input
                value={selected.note ?? ""}
                onFocus={pushUndo}
                onChange={(ev) => updateNodeFn(selected.id, { note: ev.target.value })}
                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${inp}`}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Ícone (emoji)</label>
              <input
                value={selected.icon || ""}
                onFocus={pushUndo}
                onChange={(ev) => updateNodeFn(selected.id, { icon: ev.target.value.slice(0, 2) })}
                placeholder="💡"
                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${inp}`}
              />
              <EmojiPicker
                value={selected.icon || ""}
                onPick={(icon) => updateNodeFn(selected.id, { icon })}
                isDark={isDark}
              />
            </div>

            <div>
              <button
                onClick={() => {
                  setNotesEditMode(!selected.markdown);
                  setShowNotesModal(true);
                }}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm font-medium transition flex items-center justify-center gap-2 ${btn}`}
              >
                <span>📝</span> {selected.markdown ? "Ver Notas" : "Adicionar Nota"}
              </button>
              {selected.markdown && (
                <div
                  className={`mt-2 p-2 rounded-lg border max-h-24 overflow-y-auto custom-scroll ${isDark ? "border-white/5 bg-white/[.03]" : "border-black/5 bg-slate-50"}`}
                >
                  {renderMarkdown(selected.markdown, openNoteLink)}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-500 block mb-1">Checklist</label>
              <div className="space-y-1">
                {(selected.checklist || []).map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        pushUndo();
                        const list = [...(selected.checklist || [])];
                        list[i] = { ...list[i], done: !list[i].done };
                        updateNodeFn(selected.id, { checklist: list });
                      }}
                      className="text-sm"
                    >
                      {c.done ? "☑" : "☐"}
                    </button>
                    <input
                      value={c.text}
                      onChange={(ev) => {
                        pushUndo();
                        const list = [...(selected.checklist || [])];
                        list[i] = { ...list[i], text: ev.target.value };
                        updateNodeFn(selected.id, { checklist: list });
                      }}
                      className={`flex-1 rounded-lg border px-2 py-1 text-xs outline-none ${inp}`}
                    />
                    <button
                      onClick={() => {
                        pushUndo();
                        const list = (selected.checklist || []).filter((_, idx) => idx !== i);
                        updateNodeFn(selected.id, { checklist: list });
                      }}
                      className="text-xs text-rose-400"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    pushUndo();
                    updateNodeFn(selected.id, {
                      checklist: [...(selected.checklist || []), { text: "Novo item", done: false }],
                    });
                  }}
                  className={`text-xs w-full rounded-lg border px-2 py-1 ${btn}`}
                >
                  + Adicionar item
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-500">📎 Links e Anexos</label>
                <button
                  onClick={() => addAttachment(selected.id, "url")}
                  className={`rounded-lg border px-2 py-1 text-[10px] ${btn}`}
                >
                  + Inserir
                </button>
              </div>
              <div className="space-y-1.5">
                {ATTACH_TYPES.map((cat) => {
                  const items = (selected.attachments || []).filter((a) => a.type === cat.type);
                  if (items.length === 0) return null;
                  return (
                    <div key={cat.type}>
                      <p className="text-[10px] uppercase tracking-[.15em] text-slate-500 mb-1">
                        {cat.icon} {cat.label} ({items.length})
                      </p>
                      <div className="space-y-1">
                        {items.map((a) => (
                          <div
                            key={a.id}
                            className={`flex items-center justify-between rounded-lg border px-2 py-1.5 text-xs ${isDark ? "border-white/8 bg-white/[.03]" : "border-black/5 bg-slate-50"}`}
                          >
                            <span className="truncate flex-1 font-mono" title={a.path}>
                              {a.name}
                            </span>
                            <div className="flex gap-1 ml-2">
                              <button
                                onClick={() => openAttach(a)}
                                className="text-indigo-400 hover:text-indigo-300"
                                title="Abrir"
                              >
                                ▶
                              </button>
                              <button
                                onClick={() => removeAttachment(selected.id, a.id)}
                                className="text-rose-400 hover:text-rose-300"
                                title="Remover"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {(selected.attachments || []).length === 0 && (
                  <p className="text-xs text-slate-500 italic">Sem anexos. Use Ctrl+L ou botão direito no nó.</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 block mb-2">Cor da borda</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selected.borderColor || "#6366f1"}
                  onChange={(ev) => {
                    pushUndo();
                    updateNodeFn(selected.id, { borderColor: ev.target.value });
                  }}
                  className="h-8 w-12 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                />
                <div className="flex gap-1 flex-wrap flex-1">
                  {[
                    "#6366f1",
                    "#22d3ee",
                    "#34d399",
                    "#f472b6",
                    "#fb923c",
                    "#f87171",
                    "#a78bfa",
                    "#facc15",
                    "#94a3b8",
                  ].map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        pushUndo();
                        updateNodeFn(selected.id, { borderColor: c });
                      }}
                      className={`w-6 h-6 rounded-lg transition-transform hover:scale-110 ${selected.borderColor === c ? "ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-110" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <button
                    onClick={() => {
                      pushUndo();
                      updateNodeFn(selected.id, { borderColor: undefined });
                    }}
                    className={`w-6 h-6 rounded-lg border text-[9px] flex items-center justify-center transition ${isDark ? "border-white/20 text-slate-400 hover:bg-white/10" : "border-black/20 text-slate-500 hover:bg-slate-100"} ${!selected.borderColor ? "ring-2 ring-white/40" : ""}`}
                    title="Padrão"
                  >
                    ↺
                  </button>
                </div>
              </div>
            </div>

            <div>
              <div className="grid grid-cols-3 gap-1.5">
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      pushUndo();
                      updateNodeFn(selected.id, { shape: s.id });
                    }}
                    className={`rounded-lg border px-2 py-1.5 text-xs transition ${selected.shape === s.id ? "border-indigo-400 bg-indigo-500/15 text-indigo-200" : btn}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-slate-500">Tamanho do nó</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      pushUndo();
                      updateNodeFn(selected.id, { scale: Math.max(0.4, +((selected.scale ?? 1) - 0.1).toFixed(1)) });
                    }}
                    className={`rounded-lg border w-6 h-6 text-xs flex items-center justify-center ${btn}`}
                  >
                    −
                  </button>
                  <span className="text-xs w-9 text-center tabular-nums">
                    {Math.round((selected.scale ?? 1) * 100)}%
                  </span>
                  <button
                    onClick={() => {
                      pushUndo();
                      updateNodeFn(selected.id, { scale: Math.min(2.5, +((selected.scale ?? 1) + 0.1).toFixed(1)) });
                    }}
                    className={`rounded-lg border w-6 h-6 text-xs flex items-center justify-center ${btn}`}
                  >
                    +
                  </button>
                  <button
                    onClick={() => {
                      pushUndo();
                      updateNodeFn(selected.id, { scale: 1 });
                    }}
                    title="Resetar tamanho"
                    className={`rounded-lg border px-1.5 h-6 text-[10px] ${btn}`}
                  >
                    ↺
                  </button>
                </div>
              </div>

              <label className="text-xs text-slate-500 block mb-2">Cor do ícone</label>
              <div className="grid grid-cols-6 gap-1">
                {TONE_HEX.map((hex, i) => {
                  const isTransparent = hex === "transparent";
                  const isSelected = selected.tone === i;
                  return (
                    <button
                      key={i}
                      title={isTransparent ? "Transparente" : hex}
                      onClick={() => {
                        pushUndo();
                        updateNodeFn(selected.id, { tone: i });
                      }}
                      className={`relative w-full aspect-square rounded-xl transition-transform ${isSelected ? "ring-2 ring-indigo-400 ring-offset-2 scale-105" : "hover:scale-105"} ${isDark ? "ring-offset-slate-900" : "ring-offset-white"}`}
                      style={isTransparent ? {} : { backgroundColor: hex }}
                    >
                      {isTransparent && (
                        <span
                          className={`absolute inset-0 rounded-xl overflow-hidden flex items-center justify-center border-2 ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-black/4"}`}
                        >
                          <svg width="100%" height="100%" className="absolute inset-0 opacity-30">
                            <line
                              x1="0"
                              y1="100%"
                              x2="100%"
                              y2="0"
                              stroke={isDark ? "#fff" : "#000"}
                              strokeWidth="1.5"
                            />
                          </svg>
                          <span className="text-base relative z-10">🚫</span>
                        </span>
                      )}
                      {isSelected && !isTransparent && (
                        <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold drop-shadow">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className={`text-[11px] mt-1.5 ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                Transparente destaca o emoji sem fundo colorido
              </p>
            </div>

            <div className="mt-auto space-y-2 pt-4">
              <button
                onClick={() => addChildNode(selected.id)}
                className="w-full rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-600 transition"
              >
                + Adicionar nó filho
              </button>
              <button onClick={duplicateSel} className={`w-full rounded-xl border px-3 py-2 text-sm ${btn}`}>
                Duplicar nó
              </button>
              <button
                onClick={() => deleteNodes(sel)}
                className="w-full rounded-xl border border-rose-500/30 px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10 transition"
              >
                Excluir nó
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* ─── CONTEXT MENU ───────────────────────────── */}
      {ctx && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setCtx(null);
              setCtxCopyToMap(false);
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              setCtx(null);
              setCtxCopyToMap(false);
            }}
          />
          <div
            role="menu"
            aria-label="Menu de contexto"
            className={`fixed z-50 rounded-lg border shadow-2xl p-0.5 min-w-[11rem] ${isDark ? "border-white/10 bg-slate-900/95 backdrop-blur-xl text-slate-200" : "border-black/10 bg-white/95 backdrop-blur-xl text-slate-800"}`}
            style={{ left: Math.min(ctx.x, window.innerWidth - 200), top: Math.min(ctx.y, window.innerHeight - 260) }}
          >
            {ctx.nodeId && (
              <>
                <CtxBtn
                  label="+ Adicionar nó filho"
                  onClick={() => {
                    addChildNode(ctx.nodeId!);
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="✎ Editar título"
                  onClick={() => {
                    setEditId(ctx.nodeId!);
                    setEditField("title");
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="📝 Notas"
                  onClick={() => {
                    const nid = ctx.nodeId!;
                    setSel(new Set([nid]));
                    const n = nodeMap.get(nid);
                    setNotesEditMode(!n?.markdown);
                    setShowNotesModal(true);
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="☑ Checklist"
                  onClick={() => {
                    const nid = ctx.nodeId!;
                    setSel(new Set([nid]));
                    setChecklistNodeId(nid);
                    setNewCheckItem("");
                    setShowChecklistModal(true);
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="⊞ Duplicar"
                  onClick={() => {
                    duplicateSel();
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="📋 Copiar"
                  onClick={() => {
                    copySel();
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="📄 Colar"
                  onClick={() => {
                    pasteSel();
                    setCtx(null);
                  }}
                />
                {ws.maps.filter((m) => m.id !== map.id).length > 0 && (
                  <div className="relative">
                    <CtxBtn
                      label={`📋 Copiar para mapa ▸ ${sel.size > 1 ? `(${sel.size} nós)` : ""}`}
                      onClick={() => setCtxCopyToMap((v) => !v)}
                    />
                    {ctxCopyToMap && (
                      <div
                        className={`absolute left-0 top-full mt-0.5 rounded-lg border shadow-2xl p-0.5 min-w-[13rem] max-h-40 overflow-y-auto z-50 ${
                          isDark
                            ? "border-white/10 bg-slate-900/98 backdrop-blur-xl text-slate-200"
                            : "border-black/10 bg-white/98 backdrop-blur-xl text-slate-800"
                        }`}
                      >
                        {ws.maps
                          .filter((m) => m.id !== map.id)
                          .map((m) => (
                            <CtxBtn
                              key={m.id}
                              label={m.title}
                              onClick={() => {
                                copyNodesToMap(m.id);
                                setCtxCopyToMap(false);
                                setCtx(null);
                              }}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                )}
                <CtxBtn
                  label={collapsed.has(ctx.nodeId!) ? "▸ Expandir ramo" : "▸ Colapsar ramo"}
                  onClick={() => {
                    toggleCollapse(ctx.nodeId!);
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="📎 Inserir Links/Anexos"
                  onClick={() => {
                    addAttachment(ctx.nodeId!, "url");
                    setCtx(null);
                  }}
                />
                <div className={`my-1 h-px ${isDark ? "bg-white/10" : "bg-black/10"}`} />
                <CtxBtn
                  label="🗑 Excluir nó"
                  danger
                  onClick={() => {
                    deleteNodes(new Set([ctx.nodeId!]));
                    setCtx(null);
                  }}
                />
              </>
            )}
            {ctx.edgeId && (
              <>
                <CtxBtn
                  label="— Linha sólida"
                  onClick={() => {
                    updateEdgeStyle(ctx.edgeId!, "solid");
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="- - Linha tracejada"
                  onClick={() => {
                    updateEdgeStyle(ctx.edgeId!, "dashed");
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="· · Linha pontilhada"
                  onClick={() => {
                    updateEdgeStyle(ctx.edgeId!, "dotted");
                    setCtx(null);
                  }}
                />
                <div className={`my-1 h-px ${isDark ? "bg-white/10" : "bg-black/10"}`} />
                <CtxBtn
                  label="🗑 Remover conexão"
                  danger
                  onClick={() => {
                    deleteEdgeFn(ctx.edgeId!);
                    setCtx(null);
                  }}
                />
              </>
            )}
            {!ctx.nodeId && !ctx.edgeId && (
              <>
                <CtxBtn
                  label="+ Novo nó aqui"
                  onClick={() => {
                    addNodeAt(ctx.wx!, ctx.wy!);
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="📄 Colar"
                  onClick={() => {
                    pasteSel();
                    setCtx(null);
                  }}
                />
                <CtxBtn
                  label="⊞ Ajustar zoom"
                  onClick={() => {
                    fitView();
                    setCtx(null);
                  }}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* ─── CREATE MAP MODAL ───────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
            className={`w-full max-w-lg rounded-3xl border p-6 shadow-2xl ${isDark ? "border-white/10 bg-[#0e111d]" : "border-black/10 bg-white"}`}
          >
            <h3 className="text-xl font-semibold">Criar novo mapa</h3>
            <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Escolha um nome e um modelo
            </p>
            <label className="block mt-5 text-xs text-slate-500">Nome do mapa</label>
            <input
              autoFocus
              value={draftTitle}
              onChange={(ev) => setDraftTitle(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") confirmCreate();
              }}
              placeholder="Ex: Planejamento Q1"
              className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-sm outline-none ${inp}`}
            />
            <label className="block mt-4 text-xs text-slate-500">Modelo</label>
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t}
                  onClick={() => setDraftTpl(t)}
                  className={`rounded-xl border px-2 py-2 text-xs transition ${draftTpl === t ? "border-indigo-400 bg-indigo-500/15 text-indigo-200" : btn}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className={`rounded-xl border px-4 py-2 text-sm ${btn}`}>
                Cancelar
              </button>
              <button
                onClick={confirmCreate}
                className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2 text-sm font-semibold text-white shadow"
              >
                Criar mapa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── EXPORT MODAL ───────────────────────────── */}
      {showExport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowExport(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
            className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${isDark ? "border-white/10 bg-[#0e111d]" : "border-black/10 bg-white"}`}
          >
            <h3 className="text-xl font-semibold">Exportar mapa</h3>
            <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>Escolha o formato de saída</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button
                onClick={() => {
                  exportJSON(map);
                  setShowExport(false);
                }}
                className={`rounded-xl border px-4 py-3 text-sm ${btn}`}
              >
                📄 Mapa (JSON)
              </button>
              <button
                onClick={() => {
                  exportWorkspaceBackup(ws.maps);
                  setShowExport(false);
                }}
                className={`rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 px-4 py-3 text-sm hover:bg-indigo-500/20`}
              >
                💾 Backup Total (Todos os Mapas)
              </button>
              <button
                onClick={() => {
                  exportMarkdown(map);
                  setShowExport(false);
                }}
                className={`rounded-xl border px-4 py-3 text-sm ${btn}`}
              >
                📝 Markdown
              </button>
              <button
                onClick={() => {
                  exportSVG(map, isDark);
                  setShowExport(false);
                }}
                className={`rounded-xl border px-4 py-3 text-sm ${btn}`}
              >
                🎨 SVG
              </button>
              <button
                onClick={() => {
                  exportPNG(map, isDark);
                  setShowExport(false);
                }}
                className={`rounded-xl border px-4 py-3 text-sm ${btn}`}
              >
                🖼 PNG
              </button>
              <button
                onClick={() => {
                  exportHTML(map, isDark);
                  setShowExport(false);
                }}
                className={`rounded-xl border px-4 py-3 text-sm ${btn}`}
              >
                🌐 HTML
              </button>
              <button
                onClick={() => {
                  printMap(map, isDark);
                  setShowExport(false);
                }}
                className={`rounded-xl border px-4 py-3 text-sm ${btn}`}
              >
                🖨 Imprimir
              </button>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setShowExport(false)} className={`rounded-xl border px-4 py-2 text-sm ${btn}`}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── IMPORT MODAL ───────────────────────────── */}
      {showImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowImport(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
            className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${isDark ? "border-white/10 bg-[#0e111d]" : "border-black/10 bg-white"}`}
          >
            <h3 className="text-xl font-semibold">Importar mapa</h3>
            <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Selecione um arquivo compatível
            </p>
            <div className="mt-5 space-y-2">
              <label
                className={`flex flex-col items-center justify-center w-full h-28 rounded-2xl border-2 border-dashed cursor-pointer transition ${isDark ? "border-white/10 hover:border-white/20 bg-white/[.02]" : "border-black/10 hover:border-black/20 bg-slate-50"}`}
              >
                <span className="text-2xl mb-1">📁</span>
                <span className="text-sm">Clique para selecionar arquivo</span>
                <span className="text-xs text-slate-500 mt-1">Backup Total, JSON, Markdown, FreeMind, XMind, OPML</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".json,.md,.markdown,.mm,.xmind,.opml"
                  onChange={(ev) => {
                    const f = ev.target.files?.[0];
                    if (f) handleImport(f);
                  }}
                />
              </label>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setShowImport(false)} className={`rounded-xl border px-4 py-2 text-sm ${btn}`}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal de Inserção de Anexo ─────────────── */}
      {attachModal &&
        (() => {
          const att = ATTACH_TYPES.find((a) => a.type === attachModal.type)!;
          const isMapType = attachModal.type === "map";
          const otherMaps = ws.maps.filter((m) => m.id !== map.id);
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
              onClick={() => setAttachModal(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                onClick={(ev) => ev.stopPropagation()}
                className={`w-full max-w-lg rounded-3xl border p-6 shadow-2xl ${isDark ? "border-white/10 bg-[#0e111d]" : "border-black/10 bg-white"}`}
              >
                <h3 className="text-xl font-semibold">📎 Inserir {att.label}</h3>
                <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {isMapType
                    ? "Selecione um mapa do workspace para vincular"
                    : att.type === "url"
                      ? "Cole o endereço web ou caminho local (file:// ou C:\\)"
                      : "Cole o caminho local ou URL do arquivo"}
                </p>

                {isMapType ? (
                  <div className="mt-5 space-y-1.5 max-h-52 overflow-y-auto custom-scroll">
                    {otherMaps.length === 0 ? (
                      <p className="text-sm text-slate-500 italic">Nenhum outro mapa disponível.</p>
                    ) : (
                      otherMaps.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            confirmAttach(`map://${m.id}`, m.title);
                          }}
                          className={`w-full text-left rounded-xl border px-4 py-2.5 text-sm transition ${
                            isDark
                              ? "border-white/10 bg-white/5 hover:bg-indigo-500/15 hover:border-indigo-400/50"
                              : "border-black/10 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300"
                          }`}
                        >
                          <span className="font-medium">{m.title}</span>
                          <span className={`block text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                            {m.template} · {m.nodes.length} nós
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <>
                    <label className="block mt-5 text-xs text-slate-500">Caminho / URL</label>
                    <input
                      autoFocus
                      value={attachPath}
                      onChange={(ev) => setAttachPath(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" && attachPath.trim()) confirmAttach(attachPath.trim(), attachName);
                        if (ev.key === "Escape") setAttachModal(null);
                      }}
                      placeholder={
                        att.type === "url" ? "https://exemplo.com ou C:\\arquivo.txt" : "C:\\arquivos\\foto.png"
                      }
                      className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-sm outline-none ${inp}`}
                    />
                    <label className="block mt-3 text-xs text-slate-500">Nome (opcional)</label>
                    <input
                      value={attachName}
                      onChange={(ev) => setAttachName(ev.target.value)}
                      placeholder="Meu arquivo"
                      className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-sm outline-none ${inp}`}
                    />
                  </>
                )}

                <div className="mt-5">
                  <label className="text-xs text-slate-500 block mb-2">Tipo</label>
                  <div className="flex gap-2 flex-wrap">
                    {ATTACH_TYPES.map((t) => (
                      <button
                        key={t.type}
                        onClick={() => setAttachModal({ nodeId: attachModal.nodeId, type: t.type })}
                        className={`flex flex-col items-center rounded-xl border p-3 w-16 transition ${
                          attachModal.type === t.type
                            ? "border-indigo-400 bg-indigo-500/15 text-indigo-200"
                            : isDark
                              ? "border-white/10 bg-white/5 hover:bg-white/10"
                              : "border-black/10 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <span className="emoji text-2xl">{t.icon}</span>
                        <span className="text-[10px] mt-1">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button onClick={() => setAttachModal(null)} className={`rounded-xl border px-4 py-2 text-sm ${btn}`}>
                    Cancelar
                  </button>
                  {!isMapType && (
                    <button
                      onClick={() => confirmAttach(attachPath.trim(), attachName)}
                      disabled={!attachPath.trim()}
                      className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-40"
                    >
                      Inserir
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {/* ─── Modal de Visualização de Anexos do Nó ─── */}
      {nodeAttachModal &&
        (() => {
          const node = nodeMap.get(nodeAttachModal);
          if (!node || !node.attachments?.length) return null;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
              onClick={() => setNodeAttachModal(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                onClick={(ev) => ev.stopPropagation()}
                className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${isDark ? "border-white/10 bg-[#0e111d]" : "border-black/10 bg-white"}`}
              >
                <h3 className="text-xl font-semibold">📎 Anexos de "{node.title}"</h3>
                <div className="mt-4 space-y-2 max-h-96 overflow-y-auto custom-scroll">
                  {ATTACH_TYPES.map((cat) => {
                    const items = node.attachments!.filter((a) => a.type === cat.type);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat.type}>
                        <p className="text-[10px] uppercase tracking-[.15em] text-slate-500 mb-1">
                          {cat.icon} {cat.label}
                        </p>
                        <div className="space-y-1">
                          {items.map((a) => (
                            <div
                              key={a.id}
                              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${isDark ? "border-white/8 bg-white/[.03]" : "border-black/5 bg-slate-50"}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{a.name}</p>
                                <p
                                  className={`text-[10px] truncate font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}
                                >
                                  {a.path}
                                </p>
                              </div>
                              <div className="flex gap-1 ml-2">
                                <button
                                  onClick={() => openAttach(a)}
                                  className="rounded-lg px-2 py-1 text-xs bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
                                >
                                  ▶ Abrir
                                </button>
                                <button
                                  onClick={() => {
                                    removeAttachment(node.id, a.id);
                                    setNodeAttachModal(null);
                                  }}
                                  className="rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end mt-5">
                  <button
                    onClick={() => setNodeAttachModal(null)}
                    className={`rounded-xl border px-4 py-2 text-sm ${btn}`}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ─── NOTES MODAL ────────────────────────────── */}
      {showNotesModal && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={() => {
            setShowNotesModal(false);
            setNotesEditMode(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
            className={`w-full max-w-lg rounded-3xl border shadow-2xl flex flex-col ${isDark ? "border-white/10 bg-[#0c0f1a]" : "border-black/8 bg-white"}`}
            style={{ maxHeight: "80vh" }}
          >
            {/* Header */}
            <div
              className={`flex items-center gap-3 px-5 py-4 border-b ${isDark ? "border-white/8" : "border-black/8"}`}
            >
              <div
                className={`h-9 w-9 shrink-0 rounded-xl ${iconBg(selected.tone, isDark)} flex items-center justify-center text-base shadow`}
              >
                {selected.icon || "📝"}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>Nota</p>
                <h3 className="text-sm font-semibold truncate">{selected.title}</h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {notesEditMode ? (
                  <button
                    onClick={() => setNotesEditMode(false)}
                    className="rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white px-3 py-1.5 text-xs font-medium transition shadow shadow-indigo-500/30"
                  >
                    ✓ Concluir
                  </button>
                ) : (
                  <button
                    onClick={() => setNotesEditMode(true)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${btn}`}
                  >
                    ✎ Editar
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowNotesModal(false);
                    setNotesEditMode(false);
                  }}
                  className={`rounded-xl border w-8 h-8 flex items-center justify-center text-sm transition ${btn}`}
                  title="Fechar"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scroll">
              {notesEditMode ? (
                <textarea
                  autoFocus
                  value={selected.markdown || ""}
                  onChange={(ev) => updateNodeFn(selected.id, { markdown: ev.target.value })}
                  placeholder="Escreva sua nota aqui..."
                  className={`w-full h-full min-h-[280px] px-5 py-4 text-sm leading-relaxed resize-none outline-none bg-transparent ${isDark ? "text-slate-200 placeholder:text-slate-600" : "text-slate-800 placeholder:text-slate-400"}`}
                />
              ) : selected.markdown ? (
                <div className="px-5 py-4">
                  {selected.markdown.split("\n").map((line, i) =>
                    line.trim() === "" ? (
                      <div key={i} className="h-3" />
                    ) : (
                      <p key={i} className={`text-sm leading-relaxed ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                        {line}
                      </p>
                    ),
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <span className="text-4xl opacity-20">📝</span>
                  <p className={`text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>Nenhuma nota ainda</p>
                  <button
                    onClick={() => setNotesEditMode(true)}
                    className="rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 text-xs font-medium transition shadow shadow-indigo-500/30"
                  >
                    + Adicionar nota
                  </button>
                </div>
              )}
            </div>

            {/* Footer — character count */}
            {(notesEditMode || selected.markdown) && (
              <div
                className={`px-5 py-2.5 border-t flex items-center justify-between ${isDark ? "border-white/8" : "border-black/8"}`}
              >
                <span className={`text-xs ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                  {(selected.markdown || "").length} caracteres
                </span>
                {selected.markdown && !notesEditMode && (
                  <button
                    onClick={() => {
                      updateNodeFn(selected.id, { markdown: "" });
                    }}
                    className={`text-xs ${isDark ? "text-slate-600 hover:text-red-400" : "text-slate-400 hover:text-red-500"} transition`}
                  >
                    Limpar nota
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── CHECKLIST MODAL ────────────────────────── */}
      {showChecklistModal &&
        (() => {
          const clNode = checklistNodeId ? nodeMap.get(checklistNodeId) : null;
          if (!clNode) return null;
          const list = clNode.checklist || [];
          const done = list.filter((c) => c.done).length;
          const pct = list.length ? Math.round((done / list.length) * 100) : 0;

          function updateList(next: typeof list) {
            updateNodeFn(clNode!.id, { checklist: next });
          }
          function toggleItem(i: number) {
            pushUndo();
            const next = [...list];
            next[i] = { ...next[i], done: !next[i].done };
            updateList(next);
          }
          function removeItem(i: number) {
            pushUndo();
            updateList(list.filter((_, idx) => idx !== i));
          }
          function addItem() {
            const text = newCheckItem.trim();
            if (!text) return;
            pushUndo();
            updateList([...list, { text, done: false }]);
            setNewCheckItem("");
          }
          function clearDone() {
            pushUndo();
            updateList(list.filter((c) => !c.done));
          }

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
              onClick={() => setShowChecklistModal(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                onClick={(ev) => ev.stopPropagation()}
                className={`w-full max-w-md rounded-3xl border shadow-2xl flex flex-col ${isDark ? "border-white/10 bg-[#0c0f1a]" : "border-black/8 bg-white"}`}
                style={{ maxHeight: "82vh" }}
              >
                {/* Header */}
                <div
                  className={`flex items-center gap-3 px-5 py-4 border-b ${isDark ? "border-white/8" : "border-black/8"}`}
                >
                  <div
                    className={`h-9 w-9 shrink-0 rounded-xl ${iconBg(clNode.tone, isDark)} flex items-center justify-center text-base shadow`}
                  >
                    {clNode.icon || "☑"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Checklist
                    </p>
                    <h3 className="text-sm font-semibold truncate">{clNode.title}</h3>
                  </div>
                  <button
                    onClick={() => setShowChecklistModal(false)}
                    className={`rounded-xl border w-8 h-8 flex items-center justify-center text-sm transition ${btn}`}
                  >
                    ×
                  </button>
                </div>

                {/* Progress bar */}
                {list.length > 0 && (
                  <div className={`px-5 pt-3 pb-2`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {done} de {list.length} concluído{done !== 1 ? "s" : ""}
                      </span>
                      <span
                        className={`text-[11px] font-bold ${pct === 100 ? "text-emerald-400" : isDark ? "text-slate-400" : "text-slate-500"}`}
                      >
                        {pct}%
                      </span>
                    </div>
                    <div className={`h-1.5 w-full rounded-full ${isDark ? "bg-white/8" : "bg-black/8"}`}>
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-emerald-400" : "bg-indigo-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Items */}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scroll px-3 py-2">
                  {list.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <span className="text-3xl opacity-20">☑</span>
                      <p className={`text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>Nenhum item ainda</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {list.map((c, i) => (
                        <div
                          key={i}
                          className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${isDark ? "hover:bg-white/4" : "hover:bg-black/3"}`}
                        >
                          <button
                            onClick={() => toggleItem(i)}
                            className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${
                              c.done
                                ? "bg-emerald-500 border-emerald-500 text-white"
                                : isDark
                                  ? "border-white/20 hover:border-indigo-400"
                                  : "border-black/20 hover:border-indigo-500"
                            }`}
                          >
                            {c.done && <span className="text-[10px] font-bold">✓</span>}
                          </button>
                          <span
                            className={`flex-1 text-sm leading-snug ${c.done ? "line-through " + (isDark ? "text-slate-500" : "text-slate-400") : ""}`}
                          >
                            {c.text}
                          </span>
                          <button
                            onClick={() => removeItem(i)}
                            className={`opacity-0 group-hover:opacity-100 text-xs transition rounded px-1 py-0.5 ${isDark ? "text-slate-500 hover:text-rose-400" : "text-slate-400 hover:text-rose-500"}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add item */}
                <div className={`px-4 py-3 border-t ${isDark ? "border-white/8" : "border-black/8"}`}>
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      addItem();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      autoFocus={list.length === 0}
                      value={newCheckItem}
                      onChange={(ev) => setNewCheckItem(ev.target.value)}
                      placeholder="Adicionar item…"
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm outline-none ${inp}`}
                    />
                    <button
                      type="submit"
                      disabled={!newCheckItem.trim()}
                      className="rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white px-3 py-2 text-sm font-medium transition"
                    >
                      +
                    </button>
                  </form>
                </div>

                {/* Footer */}
                {done > 0 && (
                  <div
                    className={`px-5 py-2.5 border-t flex items-center justify-between ${isDark ? "border-white/8" : "border-black/8"}`}
                  >
                    <span className={`text-[11px] ${isDark ? "text-slate-600" : "text-slate-400"}`}>
                      {done} item{done !== 1 ? "s" : ""} concluído{done !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={clearDone}
                      className={`text-[11px] transition ${isDark ? "text-slate-600 hover:text-rose-400" : "text-slate-400 hover:text-rose-500"}`}
                    >
                      Limpar concluídos
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* ─── LAYOUT MODAL ───────────────────────────── */}
      {showLayoutModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowLayoutModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
            className={`w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden ${isDark ? "border-white/10 bg-[#0a0c18]" : "border-black/10 bg-white"}`}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between px-6 py-5 border-b ${isDark ? "border-white/10" : "border-black/10"}`}
            >
              <div>
                <h3 className="text-xl font-bold">🪄 Organizar layout</h3>
                <p className={`text-sm mt-0.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Escolha um modelo para reorganizar os {map.nodes.length} nós automaticamente
                </p>
              </div>
              <button
                onClick={() => setShowLayoutModal(false)}
                className={`rounded-xl border px-3 py-1.5 text-xs ${btn}`}
              >
                Fechar
              </button>
            </div>

            <div className="p-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                {
                  mode: "mindmap" as const,
                  icon: "🧠",
                  label: "Mapa Mental",
                  desc: "Ramos equilibrados à esquerda e à direita do nó raiz",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      <circle cx="60" cy="40" r="10" fill="currentColor" opacity=".7" />
                      {[
                        [22, 20],
                        [22, 40],
                        [22, 60],
                        [98, 20],
                        [98, 40],
                        [98, 60],
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <line x1="60" y1="40" x2={x} y2={y} stroke="currentColor" strokeWidth="1.5" opacity=".4" />
                          <circle cx={x} cy={y} r="6" fill="currentColor" opacity=".5" />
                        </g>
                      ))}
                    </svg>
                  ),
                },
                {
                  mode: "org" as const,
                  icon: "🏢",
                  label: "Organograma",
                  desc: "Hierarquia de cima para baixo, nível por nível",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      <circle cx="60" cy="12" r="8" fill="currentColor" opacity=".7" />
                      {[
                        [30, 38],
                        [60, 38],
                        [90, 38],
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <line
                            x1="60"
                            y1="20"
                            x2={x}
                            y2={y - 8}
                            stroke="currentColor"
                            strokeWidth="1.5"
                            opacity=".4"
                          />
                          <circle cx={x} cy={y} r="6" fill="currentColor" opacity=".55" />
                        </g>
                      ))}
                      {[
                        [18, 64],
                        [42, 64],
                        [74, 64],
                        [98, 64],
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <line
                            x1={i < 2 ? 30 : 90}
                            y1="44"
                            x2={x}
                            y2={y - 6}
                            stroke="currentColor"
                            strokeWidth="1.2"
                            opacity=".35"
                          />
                          <rect x={x - 7} y={y - 6} width="14" height="10" rx="3" fill="currentColor" opacity=".45" />
                        </g>
                      ))}
                    </svg>
                  ),
                },
                {
                  mode: "tree" as const,
                  icon: "🌳",
                  label: "Árvore",
                  desc: "Cresce da esquerda para a direita em ramificações",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      <circle cx="16" cy="40" r="8" fill="currentColor" opacity=".7" />
                      {[
                        [50, 20],
                        [50, 60],
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <line x1="24" y1="40" x2={x} y2={y} stroke="currentColor" strokeWidth="1.5" opacity=".4" />
                          <circle cx={x} cy={y} r="6" fill="currentColor" opacity=".55" />
                        </g>
                      ))}
                      {[
                        [84, 12],
                        [84, 28],
                        [84, 52],
                        [84, 68],
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <line
                            x1="56"
                            y1={i < 2 ? 20 : 60}
                            x2={x}
                            y2={y}
                            stroke="currentColor"
                            strokeWidth="1.2"
                            opacity=".35"
                          />
                          <circle cx={x} cy={y} r="5" fill="currentColor" opacity=".45" />
                        </g>
                      ))}
                    </svg>
                  ),
                },
                {
                  mode: "radial" as const,
                  icon: "🎯",
                  label: "Radial",
                  desc: "Filhos distribuídos em círculo ao redor do centro",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      <circle cx="60" cy="40" r="10" fill="currentColor" opacity=".7" />
                      {Array.from({ length: 6 }, (_, i) => {
                        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
                        const x = 60 + Math.cos(a) * 28,
                          y = 40 + Math.sin(a) * 24;
                        return (
                          <g key={i}>
                            <line x1="60" y1="40" x2={x} y2={y} stroke="currentColor" strokeWidth="1.5" opacity=".4" />
                            <circle cx={x} cy={y} r="5.5" fill="currentColor" opacity=".5" />
                          </g>
                        );
                      })}
                    </svg>
                  ),
                },
                {
                  mode: "flow" as const,
                  icon: "➡️",
                  label: "Fluxo",
                  desc: "Cadeia horizontal da esquerda para a direita",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      {[14, 38, 62, 86, 110].map((x, i, arr) => (
                        <g key={i}>
                          {i < arr.length - 1 && (
                            <line
                              x1={x + 8}
                              y1="40"
                              x2={arr[i + 1] - 8}
                              y2="40"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              opacity=".4"
                            />
                          )}
                          <rect
                            x={x - 8}
                            y="32"
                            width="16"
                            height="16"
                            rx="4"
                            fill="currentColor"
                            opacity={i === 0 ? 0.7 : 0.5}
                          />
                        </g>
                      ))}
                    </svg>
                  ),
                },
                {
                  mode: "fishbone" as const,
                  icon: "🐟",
                  label: "Espinha de Peixe",
                  desc: "Diagrama de causa-efeito (Ishikawa)",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      <line x1="10" y1="40" x2="110" y2="40" stroke="currentColor" strokeWidth="2" opacity=".5" />
                      <circle cx="110" cy="40" r="8" fill="currentColor" opacity=".7" />
                      {[
                        [30, 18],
                        [50, 18],
                        [70, 18],
                        [30, 62],
                        [50, 62],
                        [70, 62],
                      ].map(([x, y], i) => (
                        <g key={i}>
                          <line x1={x} y1={y} x2={x} y2="40" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
                          <circle cx={x} cy={y} r="5" fill="currentColor" opacity=".5" />
                        </g>
                      ))}
                    </svg>
                  ),
                },
                {
                  mode: "timeline" as const,
                  icon: "📅",
                  label: "Linha do Tempo",
                  desc: "Sequência horizontal com marcos alternados acima/abaixo",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      <line x1="10" y1="40" x2="110" y2="40" stroke="currentColor" strokeWidth="1.5" opacity=".3" />
                      {[14, 38, 62, 86, 110].map((x, i) => (
                        <g key={i}>
                          <line
                            x1={x}
                            y1="40"
                            x2={x}
                            y2={i % 2 === 0 ? 20 : 60}
                            stroke="currentColor"
                            strokeWidth="1.2"
                            opacity=".4"
                          />
                          <circle cx={x} cy={i % 2 === 0 ? 16 : 64} r="6" fill="currentColor" opacity=".6" />
                          <circle cx={x} cy="40" r="3" fill="currentColor" opacity=".8" />
                        </g>
                      ))}
                    </svg>
                  ),
                },
                {
                  mode: "grid" as const,
                  icon: "⊞",
                  label: "Grade",
                  desc: "Todos os nós em grade uniforme, ideal para coleções",
                  preview: (
                    <svg viewBox="0 0 120 80" className="w-full h-14">
                      {[
                        [16, 16],
                        [44, 16],
                        [72, 16],
                        [100, 16],
                        [16, 44],
                        [44, 44],
                        [72, 44],
                        [100, 44],
                        [16, 72],
                        [44, 72],
                        [72, 72],
                      ].map(([x, y], i) => (
                        <rect
                          key={i}
                          x={x - 10}
                          y={y - 8}
                          width="20"
                          height="14"
                          rx="3"
                          fill="currentColor"
                          opacity={i === 0 ? 0.75 : 0.4}
                        />
                      ))}
                    </svg>
                  ),
                },
              ].map(({ mode, icon, label, desc, preview }) => (
                <button
                  key={mode}
                  onClick={() => applyLayout(mode)}
                  className={`group rounded-2xl border p-3 text-left transition-all hover:border-indigo-400/60 hover:scale-[1.02] active:scale-[0.98] ${isDark ? "border-white/10 bg-white/[.03] hover:bg-indigo-500/8" : "border-black/10 bg-slate-50 hover:bg-indigo-50"}`}
                >
                  <div
                    className={`${isDark ? "text-indigo-300/70 group-hover:text-indigo-300" : "text-indigo-600/70 group-hover:text-indigo-600"} transition-colors`}
                  >
                    {preview}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-base">{icon}</span>
                    <span className="text-sm font-semibold">{label}</span>
                  </div>
                  <p className={`text-[11px] mt-1 leading-snug ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    {desc}
                  </p>
                </button>
              ))}
            </div>

            {/* Auto-pick footer */}
            <div
              className={`px-6 pb-5 pt-1 flex items-center justify-between border-t ${isDark ? "border-white/8" : "border-black/8"}`}
            >
              <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Modelo atual do mapa: <span className="font-semibold text-indigo-400">{map.template}</span>
              </p>
              <button
                onClick={autoOrganize}
                className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2 text-sm font-semibold text-white shadow shadow-indigo-500/30 hover:opacity-90 transition"
              >
                ✨ Aplicar modelo sugerido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── BACKGROUND PANEL ───────────────────────── */}
      {showBgPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowBgPanel(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
            className={`w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden ${isDark ? "border-white/10 bg-[#0a0c18]" : "border-black/10 bg-white"}`}
          >
            {/* Header with live preview strip */}
            <div
              className="h-24 relative overflow-hidden"
              style={{
                backgroundColor: isDark ? background.baseDark : background.baseLight,
                backgroundImage:
                  `radial-gradient(ellipse at 20% 50%, ${background.glowA}, transparent 55%), ` +
                  `radial-gradient(ellipse at 80% 50%, ${background.glowB}, transparent 50%), ` +
                  (background.glowC ? `radial-gradient(ellipse at 50% 10%, ${background.glowC}, transparent 50%)` : ""),
              }}
            >
              {background.pattern && background.pattern !== "none" && (
                <div
                  className="absolute inset-0 opacity-[0.14]"
                  style={{
                    backgroundImage: PATTERN_CSS[background.pattern],
                    backgroundSize: PATTERN_SIZES[background.pattern],
                  }}
                />
              )}
              <div className="absolute inset-0 flex items-center px-6">
                <div>
                  <h3 className="text-xl font-bold text-white drop-shadow-lg">🎨 Pano de fundo</h3>
                  <p className="text-sm text-white/70">Escolha um tema visual para o seu canvas</p>
                </div>
                <button
                  onClick={() => setShowBgPanel(false)}
                  className="ml-auto rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm transition"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Preset grid */}
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Temas</p>
              <div className="grid grid-cols-3 gap-2.5 md:grid-cols-5">
                {BACKGROUND_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => setBackground(preset)}
                    className={`group overflow-hidden rounded-2xl border transition-all ${background.name === preset.name ? "border-indigo-400 ring-2 ring-indigo-400/30 scale-[1.03]" : isDark ? "border-white/10 hover:border-white/25 hover:scale-[1.02]" : "border-black/10 hover:border-black/20 hover:scale-[1.02]"}`}
                  >
                    <div
                      className="h-16 w-full relative overflow-hidden"
                      style={{
                        backgroundColor: isDark ? preset.baseDark : preset.baseLight,
                        backgroundImage:
                          `radial-gradient(ellipse at 25% 30%, ${preset.glowA}, transparent 55%), ` +
                          `radial-gradient(ellipse at 80% 75%, ${preset.glowB}, transparent 50%), ` +
                          (preset.glowC ? `radial-gradient(ellipse at 65% 15%, ${preset.glowC}, transparent 50%)` : ""),
                      }}
                    >
                      {preset.pattern && preset.pattern !== "none" && (
                        <div
                          className="absolute inset-0 opacity-[0.18]"
                          style={{
                            backgroundImage: PATTERN_CSS[preset.pattern],
                            backgroundSize: PATTERN_SIZES[preset.pattern],
                          }}
                        />
                      )}
                      {/* Badges */}
                      <div className="absolute bottom-1 right-1 flex gap-1">
                        {preset.animated && (
                          <span className="rounded text-[9px] px-1 bg-white/20 text-white/90 backdrop-blur-sm">
                            ✦ anim
                          </span>
                        )}
                        {preset.pattern && preset.pattern !== "none" && (
                          <span className="rounded text-[9px] px-1 bg-white/20 text-white/90 backdrop-blur-sm">
                            {preset.pattern}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`px-2 py-1.5 ${isDark ? "bg-white/[.03]" : "bg-slate-50"}`}>
                      <p className="text-xs font-semibold truncate">{preset.name}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Pattern & animation toggles */}
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div
                  className={`rounded-2xl border p-4 ${isDark ? "border-white/10 bg-white/[.03]" : "border-black/10 bg-slate-50"}`}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Padrão de grade</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["none", "grid", "dots", "hex", "crosshatch"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setBackground((b) => ({ ...b, name: "Personalizado", pattern: p }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition ${background.pattern === p ? "border-indigo-400 bg-indigo-500/20 text-indigo-300" : isDark ? "border-white/10 bg-white/5 hover:bg-white/10 text-slate-300" : "border-black/10 bg-white hover:bg-slate-100 text-slate-700"}`}
                      >
                        {p === "none"
                          ? "Nenhum"
                          : p === "grid"
                            ? "Grade"
                            : p === "dots"
                              ? "Pontos"
                              : p === "hex"
                                ? "Hexágono"
                                : "Xadrez"}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${isDark ? "border-white/10 bg-white/[.03]" : "border-black/10 bg-slate-50"}`}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Animação</p>
                  <button
                    onClick={() => setBackground((b) => ({ ...b, name: "Personalizado", animated: !b.animated }))}
                    className={`rounded-xl border px-4 py-2 text-sm font-medium transition w-full ${background.animated ? "border-indigo-400 bg-indigo-500/20 text-indigo-300" : isDark ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" : "border-black/10 bg-white text-slate-700 hover:bg-slate-100"}`}
                  >
                    {background.animated ? "✦ Ativada — aurora suave" : "○ Desativada — estático"}
                  </button>
                </div>
              </div>

              {/* Custom colors */}
              <div
                className={`mt-3 rounded-2xl border p-4 ${isDark ? "border-white/10 bg-white/[.03]" : "border-black/10 bg-slate-50"}`}
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
                  Cores personalizadas
                </p>
                <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
                  <ColorInput
                    label="Base"
                    value={background.baseDark}
                    onChange={(v) => setBackground((b) => ({ ...b, name: "Personalizado", baseDark: v }))}
                  />
                  <ColorInput
                    label="Base clara"
                    value={background.baseLight}
                    onChange={(v) => setBackground((b) => ({ ...b, name: "Personalizado", baseLight: v }))}
                  />
                  <ColorInput
                    label="Brilho A"
                    value={rgbaToHex(background.glowA)}
                    onChange={(v) => setBackground((b) => ({ ...b, name: "Personalizado", glowA: hexToRgba(v, 0.65) }))}
                  />
                  <ColorInput
                    label="Brilho B"
                    value={rgbaToHex(background.glowB)}
                    onChange={(v) => setBackground((b) => ({ ...b, name: "Personalizado", glowB: hexToRgba(v, 0.55) }))}
                  />
                  <ColorInput
                    label="Brilho C"
                    value={rgbaToHex(background.glowC ?? "#000000")}
                    onChange={(v) => setBackground((b) => ({ ...b, name: "Personalizado", glowC: hexToRgba(v, 0.4) }))}
                  />
                  <ColorInput
                    label="Brilho D"
                    value={rgbaToHex(background.glowD ?? "#000000")}
                    onChange={(v) => setBackground((b) => ({ ...b, name: "Personalizado", glowD: hexToRgba(v, 0.3) }))}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <CloseFailureDialog
        open={closeDialogOpen}
        saving={closeSaving}
        error={closeError}
        failureStage={closeFailureStage}
        onRetry={() => closeGuardRef.current?.retry()}
        onCancel={() => {
          setCloseDialogOpen(false);
          setCloseError(null);
        }}
      />
      <CloseSavingNotice open={closeSaving} slow={closeSaveSlow} />
    </main>
  );
}
