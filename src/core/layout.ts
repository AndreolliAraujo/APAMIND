// Algoritmos de layout automático do canvas.

import type { LayoutPresetId, MEdge, MNode, TemplateName } from "./model";
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
  const hierarchyEdges = orientedEdges(edges, root.id);
  const kidsOf = (id: string) => {
    const seen = new Set<string>();
    return childrenOf(id, hierarchyEdges)
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

/** Modelo de organização sugerido para cada template inicial. */
export function getTemplateLayout(tpl: TemplateName): LayoutPresetId | "none" {
  if (tpl === "Organograma" || tpl === "Hierarquico") return "org";
  if (tpl === "Arvore" || tpl === "Arvore Direita" || tpl === "Arvore Esquerda") return "tree";
  if (tpl === "Radial") return "radial";
  if (tpl === "Fluxograma") return "flow";
  if (tpl === "Espinha de Peixe") return "fishbone";
  if (tpl === "Modelo A") return "mindmap";
  if (tpl === "Timeline") return "timeline";
  if (tpl === "Kanban") return "grid";
  // Minimalista usa o arranjo do mapa mental por enquanto; a Etapa 4 troca
  // por um arranjo bilateral próprio.
  if (tpl === "Minimalista") return "mindmap";
  return "none";
}

// ── Utilitários compartilhados pelos modelos ──────────────────────
const STEP_X = LAYOUT_METRICS.nodeWidth + LAYOUT_METRICS.gapX;
const STEP_Y = LAYOUT_METRICS.nodeHeight + LAYOUT_METRICS.gapY;

/** Altura do eixo da Linha do Tempo e o desvio dos marcos (acima/abaixo). */
export const TIMELINE_AXIS_Y = 380;
export const TIMELINE_OFFSET = 160;

function pickRoot(nodes: MNode[], rootId?: string): MNode | undefined {
  return (rootId ? nodes.find((n) => n.id === rootId) : undefined) ?? nodes[0];
}

/** Filhos válidos, sem arestas paralelas repetidas. */
function uniqueChildren(id: string, edges: MEdge[], byId: Map<string, MNode>): string[] {
  const seen = new Set<string>();
  return childrenOf(id, edges).filter((kid) => {
    if (!byId.has(kid) || seen.has(kid)) return false;
    seen.add(kid);
    return true;
  });
}

/**
 * Alguns templates (Espinha de Peixe) gravam as arestas apontando para a raiz.
 * A hierarquia é lida na direção que sai dela: se a raiz não tem saídas e tem
 * entradas, as arestas são invertidas para o layout.
 */
export function orientedEdges(edges: MEdge[], rootId: string): MEdge[] {
  const outgoing = edges.filter((e) => e.source === rootId).length;
  const incoming = edges.filter((e) => e.target === rootId).length;
  return outgoing === 0 && incoming > 0 ? edges.map((e) => ({ ...e, source: e.target, target: e.source })) : edges;
}

function positions(nodes: MNode[], spots: Map<string, { x: number; y: number }>): MNode[] {
  return nodes.map((n) => {
    const spot = spots.get(n.id);
    return spot ? { ...n, x: spot.x, y: spot.y } : n;
  });
}

// ── Radial: anéis por profundidade ────────────────────────────────
export function autoLayoutRadial(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = pickRoot(nodes, rootId);
  if (!root) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const oriented = orientedEdges(edges, root.id);
  const spots = new Map<string, { x: number; y: number }>();
  const cx = 500;
  const cy = 380;
  spots.set(root.id, { x: cx, y: cy });

  // BFS define o anel de cada nó; ciclos e ilhas ficam para a faixa final.
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const kid of uniqueChildren(id, oriented, byId)) {
      if (depth.has(kid)) continue;
      depth.set(kid, depth.get(id)! + 1);
      queue.push(kid);
    }
  }
  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id);
    if (!d) continue;
    const list = byDepth.get(d);
    if (list) list.push(n.id);
    else byDepth.set(d, [n.id]);
  }

  // Cada anel distribui os nós em ângulos iguais; o raio cresce até a corda
  // entre vizinhos superar a largura do cartão e os anéis não se encostarem.
  const RING_GAP = 300;
  const minArc = LAYOUT_METRICS.nodeWidth + LAYOUT_METRICS.gapX + 12;
  let radius = 0;
  const maxDepth = Math.max(0, ...byDepth.keys());
  for (let d = 1; d <= maxDepth; d++) {
    const ids = byDepth.get(d);
    if (!ids || ids.length === 0) continue;
    radius = Math.max(radius + RING_GAP, 360, ((minArc * ids.length) / (Math.PI * 2)) * 1.15);
    ids.forEach((id, i) => {
      const angle = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
      spots.set(id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
  }

  const leftovers = nodes.filter((n) => !spots.has(n.id));
  leftovers.forEach((n, i) => spots.set(n.id, { x: 120 + i * STEP_X, y: cy + radius + STEP_Y }));
  return positions(nodes, spots);
}

// ── Fluxo: colunas por profundidade, ramos empilhados ─────────────
export function autoLayoutFlow(nodes: MNode[], edges: MEdge[]) {
  if (nodes.length === 0) return nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const e of edges) {
    if (byId.has(e.source) && byId.has(e.target)) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  // Grafo todo em ciclo: ancora pelo primeiro nó para não deixar tudo solto.
  if (queue.length === 0 && nodes.length) queue.push(nodes[0].id);
  for (const id of queue) depth.set(id, 0);

  let guard = nodes.length * nodes.length + edges.length * 2 + 8;
  while (queue.length > 0 && guard-- > 0) {
    const id = queue.shift()!;
    const base = depth.get(id) ?? 0;
    for (const e of edges) {
      if (e.source !== id || !byId.has(e.target)) continue;
      const current = depth.get(e.target);
      if (current === undefined || current < base + 1) {
        depth.set(e.target, base + 1);
        queue.push(e.target);
      }
    }
  }

  const maxDepth = Math.max(0, ...depth.values());
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);

  const columns = new Map<number, string[]>();
  for (const n of [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const d = depth.get(n.id)!;
    const list = columns.get(d);
    if (list) list.push(n.id);
    else columns.set(d, [n.id]);
  }

  const spots = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of columns) {
    ids.forEach((id, i) => {
      spots.set(id, { x: 130 + d * STEP_X, y: 380 + (i - (ids.length - 1) / 2) * STEP_Y });
    });
  }
  return positions(nodes, spots);
}

// ── Mind Map: balanced branches left and right of root ────────────
export function autoLayoutMindMap(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = rootId ? nodes.find((n) => n.id === rootId) : nodes[0];
  if (!root) return nodes;
  const out = [...nodes];
  const placed = new Set<string>();
  const spots = new Map<string, { x: number; y: number }>();
  const set = (id: string, x: number, y: number) => {
    const i = out.findIndex((n) => n.id === id);
    if (i >= 0) {
      out[i] = { ...out[i], x, y };
      spots.set(id, { x, y });
      placed.add(id);
    }
  };
  const cx = 600,
    cy = 380;
  set(root.id, cx, cy);
  const oriented = orientedEdges(edges, root.id);

  // Count subtree size recursively for spacing
  // visited protege contra ciclos; reseta para cada chamada de subtreeSize
  // pois queremos o tamanho de cada subarvore de forma independente.
  function subtreeSize(id: string, visited: Set<string> = new Set<string>()): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    const kids = childrenOf(id, oriented);
    if (kids.length === 0) return 1;
    return kids.reduce((s, k) => s + subtreeSize(k, visited), 0);
  }

  const kids = childrenOf(root.id, oriented);
  const right = kids.filter((_, i) => i % 2 === 0);
  const left = kids.filter((_, i) => i % 2 !== 0);

  function placeBranch(ids: string[], side: 1 | -1, startX: number) {
    const totalH = ids.reduce((s, id) => s + Math.max(1, subtreeSize(id)) * STEP_Y, 0);
    let y = cy - totalH / 2;
    ids.forEach((id) => {
      const sh = Math.max(1, subtreeSize(id)) * STEP_Y;
      const ny = y + sh / 2;
      set(id, startX, ny);
      y += sh;
      // Place children recursively
      const grandkids = childrenOf(id, oriented);
      if (grandkids.length > 0) {
        const gx = startX + side * 320;
        const gh = grandkids.length * 140;
        let gy = ny - gh / 2;
        grandkids.forEach((gid) => {
          set(gid, gx, gy + 70);
          gy += 140;
          // Great-grandchildren
          const ggkids = childrenOf(gid, oriented);
          if (ggkids.length > 0) {
            const ggx = gx + side * 300;
            let ggy = gy - 70 - (ggkids.length * 130) / 2;
            ggkids.forEach((ggid) => {
              set(ggid, ggx, ggy + 65);
              ggy += 130;
            });
          }
        });
      }
    });
  }

  placeBranch(right, 1, cx + 320);
  placeBranch(left, -1, cx - 320);

  // Ramos mais fundos que os três níveis clássicos continuam a ramificação do
  // pai em vez de ficarem parados na posição antiga.
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      const parentEdge = oriented.find((e) => e.target === node.id && placed.has(e.source));
      if (!parentEdge) continue;
      const parent = spots.get(parentEdge.source)!;
      const side = parent.x >= cx ? 1 : -1;
      const siblings = oriented.filter((e) => e.source === parentEdge.source && placed.has(e.target)).length;
      set(node.id, parent.x + side * 300, parent.y + siblings * 140);
      grew = true;
    }
  }
  // Ilhas sem ligação com a raiz: fileira abaixo, para nenhum nó ficar perdido.
  let extra = 0;
  for (const node of nodes) {
    if (placed.has(node.id)) continue;
    set(node.id, cx + extra++ * 320, cy + 420);
  }
  return out;
}

// ── Espinha de peixe: espinha horizontal com braços alternados ────
export function autoLayoutFishbone(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = pickRoot(nodes, rootId);
  if (!root) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const oriented = orientedEdges(edges, root.id);
  const spots = new Map<string, { x: number; y: number }>();
  const spineY = 380;
  // A ordem dos braços segue as arestas (e não o x atual): reaplicar o modelo
  // não troca causa de cima para baixo.
  const kids = uniqueChildren(root.id, oriented, byId);
  const headX = 500 + (Math.max(1, Math.ceil(kids.length / 2)) * STEP_X) / 2 + STEP_X;
  spots.set(root.id, { x: headX, y: spineY });

  kids.forEach((id, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    // Braços em pares na mesma coluna: um acima, outro abaixo da espinha.
    spots.set(id, { x: headX - (Math.floor(i / 2) + 1) * STEP_X, y: spineY + side * STEP_Y });
  });

  // Sub-causas empilham na mesma coluna do braço, afastando-se da espinha.
  for (const id of kids) {
    const arm = spots.get(id)!;
    const side = arm.y < spineY ? -1 : 1;
    const queue = [id];
    let cursor = arm.y;
    while (queue.length) {
      const current = queue.shift()!;
      for (const kid of uniqueChildren(current, oriented, byId)) {
        if (spots.has(kid)) continue;
        cursor += side * STEP_Y;
        spots.set(kid, { x: arm.x, y: cursor });
        queue.push(kid);
      }
    }
  }

  const leftovers = nodes.filter((n) => !spots.has(n.id));
  if (leftovers.length) {
    const bottom = Math.max(...[...spots.values()].map((s) => s.y)) + STEP_Y;
    leftovers.forEach((n, i) => spots.set(n.id, { x: 120 + i * STEP_X, y: bottom }));
  }
  return positions(nodes, spots);
}

// ── Linha do tempo: sequência alternada acima/abaixo do eixo ──────
export function autoLayoutTimeline(nodes: MNode[], edges: MEdge[], rootId?: string) {
  const root = pickRoot(nodes, rootId);
  if (!root) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const oriented = orientedEdges(edges, root.id);
  const order: string[] = [];
  const seen = new Set<string>();

  // Caminho principal primeiro: a leitura do mapa vira a sequência da linha.
  let cursor: string | undefined = root.id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    order.push(cursor);
    cursor = uniqueChildren(cursor, oriented, byId).find((kid) => !seen.has(kid));
  }
  // Depois os ramos laterais, na ordem de leitura.
  const queue = [...order];
  while (queue.length) {
    const id = queue.shift()!;
    for (const kid of uniqueChildren(id, oriented, byId)) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      order.push(kid);
      queue.push(kid);
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);

  const spots = new Map<string, { x: number; y: number }>();
  order.forEach((id, i) => {
    spots.set(id, {
      x: 120 + i * STEP_X,
      y: TIMELINE_AXIS_Y + (i % 2 === 0 ? -TIMELINE_OFFSET : TIMELINE_OFFSET),
    });
  });
  return positions(nodes, spots);
}

// ── Grade: colunas uniformes, boa para coleções ───────────────────
export function autoLayoutGrid(nodes: MNode[]) {
  const spots = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return nodes;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  nodes.forEach((n, i) => {
    spots.set(n.id, {
      x: 120 + (i % cols) * STEP_X,
      y: 120 + Math.floor(i / cols) * STEP_Y,
    });
  });
  return positions(nodes, spots);
}
