// Algoritmos de layout automático do canvas.

import type { MEdge, MNode, TemplateName } from "./model";
import { childrenOf, sanitizeLog } from "./model";

// ── Layout algorithms ─────────────────────────────────────────────
// Caixa conservadora de um nó: o cartão pode chegar a max-w-[16rem] (256px) e a
// ~120px de altura com título, nota, checklist e anexo. Usar o pior caso é o que
// garante ausência de sobreposição sem medir o DOM (o core não toca na interface).
export const LAYOUT_METRICS = { nodeWidth: 256, nodeHeight: 120, gapX: 72, gapY: 64 } as const;

export type HierarchyAxis = "vertical" | "horizontal";

/**
 * Árvore hierárquica "tidy": cada nó é centralizado sobre a faixa dos filhos,
 * irmãos nunca se sobrepõem e a ordem horizontal atual é preservada (reaplicar
 * o layout não embaralha os ramos). `vertical` desce nível por nível
 * (organograma); `horizontal` cresce para a direita (árvore).
 */
export function autoLayoutHierarchical(
  nodes: MNode[],
  edges: MEdge[],
  rootId?: string,
  axis: HierarchyAxis = "vertical",
): MNode[] {
  const root = (rootId ? nodes.find((n) => n.id === rootId) : undefined) ?? nodes[0];
  if (!root) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const vertical = axis === "vertical";
  const depthStep = vertical
    ? LAYOUT_METRICS.nodeHeight + LAYOUT_METRICS.gapY
    : LAYOUT_METRICS.nodeWidth + LAYOUT_METRICS.gapX;
  const bandStep = vertical
    ? LAYOUT_METRICS.nodeWidth + LAYOUT_METRICS.gapX
    : LAYOUT_METRICS.nodeHeight + LAYOUT_METRICS.gapY;
  const origin = vertical ? { x: 500, y: 100 } : { x: 100, y: 380 };
  const crossOf = (n: MNode) => (vertical ? n.x : n.y);

  // Deduplica arestas paralelas e ordena irmãos pela posição atual.
  const kidsOf = (id: string) => {
    const seen = new Set<string>();
    return childrenOf(id, edges)
      .filter((kid) => {
        if (!byId.has(kid) || seen.has(kid)) return false;
        seen.add(kid);
        return true;
      })
      .sort((a, b) => crossOf(byId.get(a)!) - crossOf(byId.get(b)!));
  };

  // Faixa (em colunas/linhas) ocupada pela subárvore; o guarda `computing` corta ciclos.
  const widths = new Map<string, number>();
  const computing = new Set<string>();
  const bandOf = (id: string): number => {
    const cached = widths.get(id);
    if (cached !== undefined) return cached;
    if (computing.has(id)) return 1;
    computing.add(id);
    const kids = kidsOf(id);
    const total = kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + bandOf(kid), 0);
    computing.delete(id);
    widths.set(id, total);
    return total;
  };

  const placed = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const place = (id: string, depth: number, start: number) => {
    if (visited.has(id)) {
      console.warn(`APAMIND: ciclo em autoLayoutHierarchical no no ${sanitizeLog(id)}`);
      return;
    }
    visited.add(id);
    const cross = (start + bandOf(id) / 2) * bandStep;
    placed.set(id, vertical ? { x: cross, y: depth * depthStep } : { x: depth * depthStep, y: cross });
    let cursor = start;
    for (const kid of kidsOf(id)) {
      place(kid, depth + 1, cursor);
      cursor += bandOf(kid);
    }
  };
  place(root.id, 0, 0);

  // Ancora a raiz na origem, como os layouts anteriores faziam.
  const rootSpot = placed.get(root.id)!;
  const shiftX = origin.x - rootSpot.x;
  const shiftY = origin.y - rootSpot.y;
  const positioned = new Map<string, { x: number; y: number }>();
  placed.forEach((p, id) => positioned.set(id, { x: p.x + shiftX, y: p.y + shiftY }));

  // Nós fora da árvore (outra raiz, ciclo, ilha) vão para uma faixa após o fim.
  const orphans = nodes.filter((n) => !positioned.has(n.id)).sort((a, b) => crossOf(a) - crossOf(b));
  if (orphans.length) {
    const spots = [...positioned.values()];
    const lastDepth = vertical ? Math.max(...spots.map((p) => p.y)) : Math.max(...spots.map((p) => p.x));
    const rowDepth = lastDepth + depthStep;
    let cross = 100;
    for (const orphan of orphans) {
      positioned.set(orphan.id, vertical ? { x: cross, y: rowDepth } : { x: rowDepth, y: cross });
      cross += bandStep;
    }
  }

  return nodes.map((n) => {
    const spot = positioned.get(n.id);
    return spot ? { ...n, x: spot.x, y: spot.y } : n;
  });
}

export function autoLayoutOrgChart(nodes: MNode[], edges: MEdge[], rootId?: string) {
  return autoLayoutHierarchical(nodes, edges, rootId, "vertical");
}

export function autoLayoutTree(nodes: MNode[], edges: MEdge[], rootId?: string) {
  return autoLayoutHierarchical(nodes, edges, rootId, "horizontal");
}

export function autoLayoutFishbone(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = rootId ? nodes.find((n) => n.id === rootId) : nodes[0];
  if (!root) return nodes;
  const out = [...nodes];
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) out[i] = { ...out[i], x, y };
  };
  set(root.id, 850, 380);
  const kids = childrenOf(root.id, edges);
  const topKids = kids.filter((_, i) => i % 2 === 0);
  const botKids = kids.filter((_, i) => i % 2 === 1);
  topKids.forEach((id, i) => set(id, 450, 220 + i * 100));
  botKids.forEach((id, i) => set(id, 450, 480 + i * 100));
  return out;
}

export function getTemplateLayout(
  tpl: TemplateName,
): "tree" | "org" | "radial" | "flow" | "fishbone" | "mindmap" | "timeline" | "grid" | "none" {
  if (tpl === "Organograma" || tpl === "Hierarquico") return "org";
  if (tpl === "Arvore" || tpl === "Arvore Direita" || tpl === "Arvore Esquerda") return "tree";
  if (tpl === "Radial") return "radial";
  if (tpl === "Fluxograma") return "flow";
  if (tpl === "Espinha de Peixe") return "fishbone";
  if (tpl === "Modelo A") return "mindmap";
  if (tpl === "Timeline") return "timeline";
  if (tpl === "Kanban") return "grid";
  return "none";
}

export function autoLayoutRadial(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = rootId ? nodes.find((n) => n.id === rootId) : nodes[0];
  if (!root) return nodes;
  const out = [...nodes];
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) out[i] = { ...out[i], x, y };
  };
  set(root.id, 500, 380);
  const kids = childrenOf(root.id, edges);
  const r = 280;
  // Guard contra divisao por zero — kids.length === 0
  if (kids.length === 0) return out;
  kids.forEach((id, i) => {
    const a = (i / kids.length) * Math.PI * 2 - Math.PI / 2;
    set(id, 500 + Math.cos(a) * r, 380 + Math.sin(a) * r);
  });
  return out;
}

export function autoLayoutFlow(nodes: MNode[], edges: MEdge[]) {
  const out = [...nodes];
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) out[i] = { ...out[i], x, y };
  };
  const start = nodes.find((n) => edges.filter((e) => e.target === n.id).length === 0) || nodes[0];
  if (!start) return out;
  const visited = new Set<string>();
  let x = 130;
  const y = 380;
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    set(id, x, y);
    x += 210;
    const next = edges.find((e) => e.source === id)?.target;
    if (next) walk(next);
  };
  walk(start.id);
  // Place any orphans below
  let ox = 130;
  nodes
    .filter((n) => !visited.has(n.id))
    .forEach((n) => {
      set(n.id, ox, 600);
      ox += 210;
    });
  return out;
}

// ── Mind Map: balanced branches left and right of root ────────────
export function autoLayoutMindMap(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = rootId ? nodes.find((n) => n.id === rootId) : nodes[0];
  if (!root) return nodes;
  const out = [...nodes];
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) out[i] = { ...out[i], x, y };
  };
  const cx = 600,
    cy = 380;
  set(root.id, cx, cy);

  // Count subtree size recursively for spacing
  // visited protege contra ciclos; reseta para cada chamada de subtreeSize
  // pois queremos o tamanho de cada subarvore de forma independente.
  function subtreeSize(id: string, visited: Set<string> = new Set<string>()): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    const kids = childrenOf(id, edges);
    if (kids.length === 0) return 1;
    return kids.reduce((s, k) => s + subtreeSize(k, visited), 0);
  }

  const kids = childrenOf(root.id, edges);
  const right = kids.filter((_, i) => i % 2 === 0);
  const left = kids.filter((_, i) => i % 2 !== 0);

  function placeBranch(ids: string[], side: 1 | -1, startX: number) {
    const totalH = ids.reduce((s, id) => s + Math.max(1, subtreeSize(id)) * 110, 0);
    let y = cy - totalH / 2;
    ids.forEach((id) => {
      const sh = Math.max(1, subtreeSize(id)) * 110;
      const ny = y + sh / 2;
      set(id, startX, ny);
      y += sh;
      // Place children recursively
      const grandkids = childrenOf(id, edges);
      if (grandkids.length > 0) {
        const gx = startX + side * 230;
        const gh = grandkids.length * 100;
        let gy = ny - gh / 2;
        grandkids.forEach((gid) => {
          set(gid, gx, gy + 50);
          gy += 100;
          // Great-grandchildren
          const ggkids = childrenOf(gid, edges);
          if (ggkids.length > 0) {
            const ggx = gx + side * 200;
            let ggy = gy - 50 - (ggkids.length * 80) / 2;
            ggkids.forEach((ggid) => {
              set(ggid, ggx, ggy + 40);
              ggy += 80;
            });
          }
        });
      }
    });
  }

  placeBranch(right, 1, cx + 280);
  placeBranch(left, -1, cx - 280);
  return out;
}

// ── Timeline: horizontal chain with alternating up/down arms ──────
export function autoLayoutTimeline(nodes: MNode[], edges: MEdge[]) {
  const out = [...nodes];
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) out[i] = { ...out[i], x, y };
  };
  // Find chain start (no incoming edges)
  const start = nodes.find((n) => edges.filter((e) => e.target === n.id).length === 0) || nodes[0];
  if (!start) return out;
  const visited = new Set<string>();
  const chain: string[] = [];
  let cur: string | undefined = start.id;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    chain.push(cur);
    cur = edges.find((e) => e.source === cur)?.target;
  }
  const baseX = 120,
    baseY = 380,
    stepX = 210;
  chain.forEach((id, i) => {
    const yOffset = i % 2 === 0 ? -110 : 110;
    set(id, baseX + i * stepX, baseY + yOffset);
  });
  // Place children of each node above/below its parent
  chain.forEach((pid, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const kids = childrenOf(pid, edges).filter((k) => !chain.includes(k));
    const px = baseX + i * stepX;
    const py = baseY + (i % 2 === 0 ? -110 : 110);
    kids.forEach((kid, j) => set(kid, px, py + side * (150 + j * 90)));
  });
  // Orphan nodes in a row below
  let ox = 120;
  nodes
    .filter((n) => !visited.has(n.id))
    .forEach((n) => {
      set(n.id, ox, baseY + 320);
      ox += 210;
    });
  return out;
}

// ── Grid: uniform grid, good for collections/kanban ───────────────
export function autoLayoutGrid(nodes: MNode[]) {
  const out = [...nodes];
  if (nodes.length === 0) return out;
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) out[i] = { ...out[i], x, y };
  };
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.5)));
  const cellW = 220,
    cellH = 150;
  nodes.forEach((n, i) => {
    const col = i % cols,
      row = Math.floor(i / cols);
    set(n.id, 120 + col * cellW, 120 + row * cellH);
  });
  return out;
}
