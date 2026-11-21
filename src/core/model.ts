// Modelo de domínio do ApaMind: tipos, constantes e utilitários puros.
// Não importa storage, UI nem APIs do host.

export type NodeShape = "card" | "rect" | "circle" | "capsule" | "hex";
export type TemplateName =
  | "Modelo A"
  | "Radial"
  | "Hierarquico"
  | "Fluxograma"
  | "Arvore"
  | "Arvore Direita"
  | "Arvore Esquerda"
  | "Organograma"
  | "Espinha de Peixe"
  | "Livre"
  | "Kanban"
  | "Timeline";
export type AttachType = "url" | "image" | "video" | "audio" | "pdf" | "doc" | "xls" | "map";

export interface CheckItem {
  text: string;
  done: boolean;
}

export interface Attachment {
  id: string;
  type: AttachType;
  name: string;
  path: string; // URL web ou caminho local
}

export const ATTACH_ICONS: Record<AttachType, string> = {
  url: "🔗",
  image: "🖼️",
  video: "🎬",
  audio: "🎵",
  pdf: "📄",
  doc: "📝",
  xls: "📊",
  map: "🗺️",
};

export const ATTACH_TYPES: { type: AttachType; label: string; icon: string; accept?: string }[] = [
  { type: "url", label: "URL", icon: "🔗" },
  { type: "map", label: "Mapa", icon: "🗺️" },
  { type: "image", label: "Imagem", icon: "🖼️", accept: "image/*" },
  { type: "video", label: "Vídeo", icon: "🎬", accept: "video/*" },
  { type: "audio", label: "Áudio", icon: "🎵", accept: "audio/*" },
  { type: "pdf", label: "PDF", icon: "📄", accept: ".pdf" },
  { type: "doc", label: "Documento", icon: "📝", accept: ".doc,.docx,.txt,.odt" },
  { type: "xls", label: "Planilha", icon: "📊", accept: ".xls,.xlsx,.csv,.ods" },
];

export interface MNode {
  id: string;
  title: string;
  note: string;
  markdown?: string;
  checklist?: CheckItem[];
  icon?: string; // emoji
  attachments?: Attachment[];
  collapsed?: boolean; // @deprecated — estado gerenciado via MMap.collapsedIds
  x: number;
  y: number;
  tone: number;
  shape: NodeShape;
  scale?: number;
  borderColor?: string;
}

export type EdgeStyle = "solid" | "dashed" | "dotted";
// Geometria da conexão. `curve` é o padrão historico: ausência do campo
// significa curva, para os mapas antigos continuarem byte a byte iguais.
export type EdgeRouting = "curve" | "straight" | "ortho";

export const EDGE_ROUTINGS: EdgeRouting[] = ["curve", "straight", "ortho"];

export interface MEdge {
  id: string;
  source: string;
  target: string;
  style?: EdgeStyle;
  routing?: EdgeRouting;
}

export interface MMap {
  id: string;
  title: string;
  template: TemplateName;
  ts: string;
  schemaVersion?: number;
  nodes: MNode[];
  edges: MEdge[];
  collapsedIds?: string[];
}

export interface Workspace {
  active: string;
  maps: MMap[];
}

export const TEMPLATES: TemplateName[] = [
  "Modelo A",
  "Radial",
  "Hierarquico",
  "Fluxograma",
  "Arvore",
  "Arvore Direita",
  "Arvore Esquerda",
  "Organograma",
  "Espinha de Peixe",
  "Livre",
  "Kanban",
  "Timeline",
];

export const SCHEMA_VERSION = 1;

// Geração de id unica global; usa crypto.randomUUID quando disponivel (alta entropia)
// Fallback para Math.random alongado em ambientes sem crypto (WebView antigo).
function uuidLike(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* opcional: alguns contextos sfillam em file:// */
  }
  // Fallback: 22 chars base36 + timestamp — ~80 bits de entropia
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function sanitizeLog(s: string): string {
  return s.replace(/[\r\n\t]/g, "_").slice(0, 80);
}

export const uid = (p = "x") => `${p}_${uuidLike()}`;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function mkNode(
  title: string,
  note: string,
  x: number,
  y: number,
  tone: number,
  shape: NodeShape = "card",
  extra?: Partial<MNode>,
): MNode {
  return { id: uid("n"), title, note, x, y, tone, shape, ...extra };
}
export function mkEdge(source: string, target: string, style?: EdgeStyle, routing?: EdgeRouting): MEdge {
  return { id: uid("e"), source, target, style, routing };
}

/**
 * Migra o campo legado `links` (descontinuado) para anexos do tipo `url`.
 * Entradas inválidas são ignoradas e um destino já anexado não é duplicado.
 * Sem links legados, devolve o valor original intacto (inclusive `undefined`),
 * para não alterar o formato de nós que nunca usaram o campo.
 */
export function legacyLinksToAttachments(
  attachments: Attachment[] | undefined,
  links: unknown,
): Attachment[] | undefined {
  const source = Array.isArray(attachments) ? attachments : undefined;
  if (!Array.isArray(links) || links.length === 0) return source;

  let merged = source ? source.map((item) => ({ ...item })) : undefined;
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const candidate = link as { url?: unknown; label?: unknown };
    if (typeof candidate.url !== "string" || typeof candidate.label !== "string") continue;
    const url = candidate.url.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (merged?.some((item) => item.type === "url" && item.path === url)) continue;
    if (!merged) merged = [];
    merged.push({ id: uid("att"), type: "url", name: candidate.label.trim() || url, path: url });
  }
  return merged;
}

// ── Hierarchy helpers ─────────────────────────────────────────────
export function childrenOf(nodeId: string, edges: MEdge[]) {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target);
}
export function parentOf(nodeId: string, edges: MEdge[]) {
  const e = edges.find((e) => e.target === nodeId);
  return e?.source ?? null;
}
function descendantsRec(nodeId: string, edges: MEdge[], set: Set<string>) {
  for (const c of childrenOf(nodeId, edges)) {
    if (set.has(c)) {
      // ciclo detectado: ignora edge para evitar stack overflow
      console.warn(`APAMIND: ciclo detectado em descendants no no ${sanitizeLog(c)}`);
      continue;
    }
    set.add(c);
    descendantsRec(c, edges, set);
  }
}
export function descendants(nodeId: string, edges: MEdge[], set = new Set<string>()) {
  // Protecao contra ciclos: marca a raiz como visitada para evitar revisita-la
  // caso um ciclo volte para ela. Descendentes nao incluem a propria raiz.
  set.add(nodeId);
  descendantsRec(nodeId, edges, set);
  set.delete(nodeId);
  return set;
}
