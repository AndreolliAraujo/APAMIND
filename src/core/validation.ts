// Validação do formato de mapa recebido por importação.

import type { AttachType, EdgeRouting, EdgeStyle, LayoutPresetId, MMap, NodeShape, Workspace } from "./model";
import {
  ATTACH_TYPES,
  EDGE_ROUTINGS,
  LAYOUT_PRESET_IDS,
  TEMPLATES,
  legacyLinksToAttachments,
  sanitizeMapTheme,
  uid,
} from "./model";

// ── Validador central de mapa ─────────────────────────────────────
const SHAPES = new Set<NodeShape>(["card", "rect", "circle", "capsule", "hex"]);
const EDGE_STYLES = new Set<EdgeStyle>(["solid", "dashed", "dotted"]);
const EDGE_ROUTING_SET = new Set<EdgeRouting>(EDGE_ROUTINGS);
const ATTACHMENT_TYPES = new Set<AttachType>(ATTACH_TYPES.map(({ type }) => type));

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function validateMMap(raw: unknown): { ok: true; map: MMap } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Mapa inválido (esperado objeto)" };
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) return { ok: false, error: "Campo 'id' ausente ou vazio" };
  if (!isNonEmptyString(r.title)) return { ok: false, error: "Campo 'title' ausente ou vazio" };
  if (!Array.isArray(r.nodes)) return { ok: false, error: "Campo 'nodes' deve ser array" };
  if (!Array.isArray(r.edges)) return { ok: false, error: "Campo 'edges' deve ser array" };
  if (
    r.template !== undefined &&
    (typeof r.template !== "string" || !TEMPLATES.includes(r.template as MMap["template"]))
  ) {
    return { ok: false, error: `Template inválido: ${String(r.template)}` };
  }
  if (
    r.collapsedIds !== undefined &&
    (!Array.isArray(r.collapsedIds) || r.collapsedIds.some((id) => typeof id !== "string"))
  ) {
    return { ok: false, error: "Campo 'collapsedIds' deve ser array de ids" };
  }

  const nodeIds = new Set<string>();
  for (const n0 of r.nodes) {
    if (!n0 || typeof n0 !== "object") return { ok: false, error: "Nó inválido" };
    const n = n0 as Record<string, unknown>;
    if (!isNonEmptyString(n.id)) return { ok: false, error: "Nó sem 'id'" };
    if (nodeIds.has(n.id)) return { ok: false, error: `Nó com id duplicado: ${n.id}` };
    nodeIds.add(n.id);
    if (!isFiniteNumber(n.tone) || n.tone < 0) return { ok: false, error: `Nó '${n.id}' com tone inválido` };
    if (n.shape !== undefined && (typeof n.shape !== "string" || !SHAPES.has(n.shape as NodeShape)))
      return { ok: false, error: `Nó '${n.id}' com shape inválido` };
    if (n.note !== undefined && typeof n.note !== "string")
      return { ok: false, error: `Nó '${n.id}' com note inválido` };
    if (n.markdown !== undefined && typeof n.markdown !== "string")
      return { ok: false, error: `Nó '${n.id}' com markdown inválido` };
    if (
      n.checklist !== undefined &&
      (!Array.isArray(n.checklist) ||
        n.checklist.some(
          (item) =>
            !item || typeof item !== "object" || typeof item.text !== "string" || typeof item.done !== "boolean",
        ))
    )
      return { ok: false, error: `Nó '${n.id}' com checklist inválido` };
    if (n.links !== undefined && !Array.isArray(n.links))
      return { ok: false, error: `Nó '${n.id}' com links inválidos` };
    if (
      n.attachments !== undefined &&
      (!Array.isArray(n.attachments) ||
        n.attachments.some(
          (attachment) =>
            !attachment ||
            typeof attachment !== "object" ||
            !isNonEmptyString(attachment.id) ||
            typeof attachment.type !== "string" ||
            !ATTACHMENT_TYPES.has(attachment.type as AttachType) ||
            typeof attachment.name !== "string" ||
            typeof attachment.path !== "string",
        ))
    )
      return { ok: false, error: `Nó '${n.id}' com anexos inválidos` };
    if (n.icon !== undefined && typeof n.icon !== "string")
      return { ok: false, error: `Nó '${n.id}' com icon inválido` };
    if (n.scale !== undefined && !isFiniteNumber(n.scale))
      return { ok: false, error: `Nó '${n.id}' com scale inválido` };
    if (n.borderColor !== undefined && typeof n.borderColor !== "string")
      return { ok: false, error: `Nó '${n.id}' com borderColor inválido` };
    if (typeof n.title !== "string") return { ok: false, error: `Nó '${n.id}' sem 'title'` };
    if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) return { ok: false, error: `Nó '${n.id}' com x/y inválido` };
  }

  const edgeIds = new Set<string>();
  for (const e0 of r.edges) {
    if (!e0 || typeof e0 !== "object") return { ok: false, error: "Aresta inválida" };
    const e = e0 as Record<string, unknown>;
    if (!isNonEmptyString(e.id)) return { ok: false, error: "Aresta sem 'id'" };
    if (edgeIds.has(e.id)) return { ok: false, error: `Aresta com id duplicado: ${e.id}` };
    edgeIds.add(e.id);
    if (!isNonEmptyString(e.source) || !nodeIds.has(e.source as string))
      return { ok: false, error: `Aresta '${e.id}' com source órfão: ${e.source}` };
    if (!isNonEmptyString(e.target) || !nodeIds.has(e.target as string))
      return { ok: false, error: `Aresta '${e.id}' com target órfão: ${e.target}` };
    if (e.style !== undefined && (typeof e.style !== "string" || !EDGE_STYLES.has(e.style as EdgeStyle)))
      return { ok: false, error: `Aresta '${e.id}' com style inválido` };
    if (e.routing !== undefined && (typeof e.routing !== "string" || !EDGE_ROUTING_SET.has(e.routing as EdgeRouting)))
      return { ok: false, error: `Aresta '${e.id}' com routing inválido` };
  }

  // Reatribui ids únicos para garantir isolamento (previne colisões entre mapas importados)
  const idRemap = new Map<string, string>();
  for (const n of r.nodes as unknown[]) idRemap.set((n as any).id, uid("n"));
  const theme = sanitizeMapTheme(r.theme);
  const map: MMap = {
    id: uid("map"),
    title: r.title,
    template: (r.template as MMap["template"]) ?? "Livre",
    ts: isNonEmptyString(r.ts) ? (r.ts as string) : new Date().toISOString(),
    ...(typeof r.schemaVersion === "number" && Number.isFinite(r.schemaVersion)
      ? { schemaVersion: r.schemaVersion }
      : {}),
    ...(typeof r.layoutPreset === "string" && LAYOUT_PRESET_IDS.includes(r.layoutPreset as LayoutPresetId)
      ? { layoutPreset: r.layoutPreset as LayoutPresetId }
      : {}),
    ...(theme ? { theme } : {}),
    ...(Array.isArray(r.collapsedIds)
      ? { collapsedIds: r.collapsedIds.flatMap((id) => (idRemap.has(id) ? [idRemap.get(id)!] : [])) }
      : {}),
    nodes: (r.nodes as any[]).map((n) => ({
      ...n,
      id: idRemap.get(n.id),
      note: typeof n.note === "string" ? n.note : "",
      shape: n.shape ?? "card",
      // Campo legado `links` é migrado para anexos do tipo url e removido.
      attachments: legacyLinksToAttachments(n.attachments, n.links),
      links: undefined,
    })),
    edges: (r.edges as any[]).map((e) => ({
      ...e,
      id: uid("e"),
      source: idRemap.get(e.source)!,
      target: idRemap.get(e.target)!,
    })),
  };
  return { ok: true, map };
}

export interface WorkspaceIssue {
  code: string;
  message: string;
  path: string;
}

/**
 * Valida a integridade estrutural de um workspace JÁ migrado, sem reatribuir ids.
 * Usada na carga para recusar dados que quebrariam a interface, preservando o arquivo.
 */
export function validateWorkspaceIntegrity(ws: Workspace): WorkspaceIssue[] {
  const issues: WorkspaceIssue[] = [];
  const add = (code: string, message: string, path: string) => issues.push({ code, message, path });

  if (!ws || !Array.isArray(ws.maps) || ws.maps.length === 0) {
    add("no-maps", "Workspace sem mapas.", "maps");
    return issues;
  }

  const mapIds = new Set<string>();
  ws.maps.forEach((map, mi) => {
    const at = `maps[${mi}]`;
    if (!map || typeof map !== "object") {
      add("bad-map", "Mapa inválido.", at);
      return;
    }
    if (typeof map.id !== "string" || map.id === "") add("bad-map-id", "Mapa sem id.", `${at}.id`);
    else if (mapIds.has(map.id)) add("duplicate-map-id", `Id de mapa duplicado: ${map.id}.`, `${at}.id`);
    else mapIds.add(map.id);

    if (typeof map.title !== "string") add("bad-map-title", "Mapa sem título.", `${at}.title`);
    if (!Array.isArray(map.nodes)) {
      add("bad-nodes", "Campo nodes deve ser lista.", `${at}.nodes`);
      return;
    }
    if (!Array.isArray(map.edges)) {
      add("bad-edges", "Campo edges deve ser lista.", `${at}.edges`);
      return;
    }

    const nodeIds = new Set<string>();
    map.nodes.forEach((node, ni) => {
      const nat = `${at}.nodes[${ni}]`;
      if (!node || typeof node !== "object") {
        add("bad-node", "Nó inválido.", nat);
        return;
      }
      if (typeof node.id !== "string" || node.id === "") add("bad-node-id", "Nó sem id.", `${nat}.id`);
      else if (nodeIds.has(node.id)) add("duplicate-node-id", `Id de nó duplicado: ${node.id}.`, `${nat}.id`);
      else nodeIds.add(node.id);

      if (typeof node.title !== "string") add("bad-node-title", "Nó sem título.", `${nat}.title`);
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) add("bad-node-position", "Nó sem posição válida.", nat);
      if (typeof node.tone !== "number" || !Number.isFinite(node.tone)) add("bad-node-tone", "Nó sem tom válido.", nat);
      if (
        node.attachments !== undefined &&
        (!Array.isArray(node.attachments) ||
          node.attachments.some((a) => !a || typeof a.id !== "string" || typeof a.path !== "string"))
      ) {
        add("bad-attachments", "Anexos inválidos.", `${nat}.attachments`);
      }
    });

    const edgeIds = new Set<string>();
    map.edges.forEach((edge, ei) => {
      const eat = `${at}.edges[${ei}]`;
      if (!edge || typeof edge !== "object") {
        add("bad-edge", "Aresta inválida.", eat);
        return;
      }
      if (typeof edge.id !== "string" || edge.id === "") add("bad-edge-id", "Aresta sem id.", `${eat}.id`);
      else if (edgeIds.has(edge.id)) add("duplicate-edge-id", `Id de aresta duplicado: ${edge.id}.`, `${eat}.id`);
      else edgeIds.add(edge.id);

      if (typeof edge.source !== "string" || !nodeIds.has(edge.source))
        add("orphan-edge-source", `Aresta com origem inexistente: ${String(edge.source)}.`, `${eat}.source`);
      if (typeof edge.target !== "string" || !nodeIds.has(edge.target))
        add("orphan-edge-target", `Aresta com destino inexistente: ${String(edge.target)}.`, `${eat}.target`);
    });
  });

  return issues;
}
