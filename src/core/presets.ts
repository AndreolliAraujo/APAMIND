// Modelos de organização do canvas ("Organizar layout").
//
// Cada preset reúne, num só lugar: o posicionamento dos nós, a geometria das
// conexões e a amostra usada para desenhar a miniatura do card. A miniatura é
// gerada a partir do próprio preset (ver PresetPreview), então a figura do card
// e o resultado aplicado não podem divergir.

import type { EdgeRouting, LayoutPresetId, MEdge, MNode } from "./model";
import { mkEdge, mkNode } from "./model";
import { edgePath, fishboneEdgePath, timelineEdgePath } from "./geometry";
import {
  LAYOUT_METRICS,
  TIMELINE_AXIS_Y,
  TIMELINE_OFFSET,
  autoLayoutFishbone,
  autoLayoutFlow,
  autoLayoutGrid,
  autoLayoutHierarchical,
  autoLayoutMindMap,
  autoLayoutRadial,
  autoLayoutTimeline,
} from "./layout";

export interface PresetSample {
  nodes: MNode[];
  edges: MEdge[];
}

export interface LayoutPreset {
  id: LayoutPresetId;
  label: string;
  icon: string;
  desc: string;
  /** Geometria gravada nas arestas ao aplicar. `null` = o modelo desenha a conexão. */
  routing: EdgeRouting | null;
  /** Conexão exclusiva do modelo (espinha/eixo), desenhada pelo canvas. */
  edgeStyle?: "fishbone" | "timeline";
  layout(nodes: MNode[], edges: MEdge[], rootId?: string): MNode[];
  sample(): PresetSample;
}

// ── Amostras usadas nas miniaturas dos cards ──────────────────────
function star(count: number): PresetSample {
  const root = mkNode("Centro", "", 500, 380, 0, "capsule");
  const nodes: MNode[] = [root];
  const edges: MEdge[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    const child = mkNode(`Ramo ${i + 1}`, "", 500 + Math.cos(angle) * 320, 380 + Math.sin(angle) * 320, i % 16);
    nodes.push(child);
    edges.push(mkEdge(root.id, child.id));
  }
  return { nodes, edges };
}

function chain(count: number): PresetSample {
  const nodes = Array.from({ length: count }, (_, i) => mkNode(`Etapa ${i + 1}`, "", 120 + i * 220, 380, i % 16));
  const edges = nodes.slice(0, -1).map((node, i) => mkEdge(node.id, nodes[i + 1].id));
  return { nodes, edges };
}

/** Raiz, três filhos e quatro netos (dois sob o primeiro, dois sob o último). */
function orgSample(horizontal = false): PresetSample {
  // vertical: profundidade no y e irmãos no x; horizontal: espelhado.
  const place = (depth: number, cross: number) => (horizontal ? { x: depth, y: cross } : { x: cross, y: depth });
  const make = (depth: number, cross: number, label: string, tone: number) => {
    const spot = place(depth, cross);
    return mkNode(label, "", spot.x, spot.y, tone);
  };
  const root = make(100, 380, "Diretoria", 0);
  const first = make(280, 250, "Filho A", 1);
  const middle = make(280, 380, "Filho B", 2);
  const last = make(280, 510, "Filho C", 3);
  const grandkids = [
    make(460, 200, "Neto 1", 4),
    make(460, 300, "Neto 2", 5),
    make(460, 450, "Neto 3", 6),
    make(460, 550, "Neto 4", 7),
  ];
  return {
    nodes: [root, first, middle, last, ...grandkids],
    edges: [
      mkEdge(root.id, first.id),
      mkEdge(root.id, middle.id),
      mkEdge(root.id, last.id),
      mkEdge(first.id, grandkids[0].id),
      mkEdge(first.id, grandkids[1].id),
      mkEdge(last.id, grandkids[2].id),
      mkEdge(last.id, grandkids[3].id),
    ],
  };
}

function gridSample(count: number): PresetSample {
  const nodes = Array.from({ length: count }, (_, i) => mkNode(`Item ${i + 1}`, "", 120, 120, i % 16));
  return { nodes, edges: [] };
}

// ── Presets ───────────────────────────────────────────────────────
export const PRESETS: readonly LayoutPreset[] = [
  {
    id: "mindmap",
    icon: "🧠",
    label: "Mapa Mental",
    desc: "Ramos equilibrados à esquerda e à direita do nó raiz",
    routing: "straight",
    layout: (nodes, edges, rootId) => autoLayoutMindMap(nodes, edges, rootId),
    sample: () => star(6),
  },
  {
    id: "org",
    icon: "🏢",
    label: "Organograma",
    desc: "Hierarquia de cima para baixo, nível por nível",
    routing: "ortho",
    layout: (nodes, edges, rootId) => autoLayoutHierarchical(nodes, edges, rootId, "vertical"),
    sample: () => orgSample(false),
  },
  {
    id: "tree",
    icon: "🌳",
    label: "Árvore",
    desc: "Cresce da esquerda para a direita em ramificações",
    routing: "ortho",
    layout: (nodes, edges, rootId) => autoLayoutHierarchical(nodes, edges, rootId, "horizontal"),
    sample: () => orgSample(true),
  },
  {
    id: "radial",
    icon: "🎯",
    label: "Radial",
    desc: "Anéis ao redor do centro, um por nível",
    routing: "straight",
    layout: (nodes, edges, rootId) => autoLayoutRadial(nodes, edges, rootId),
    sample: () => star(6),
  },
  {
    id: "flow",
    icon: "➡️",
    label: "Fluxo",
    desc: "Cadeia horizontal, com ramos empilhados por etapa",
    routing: "ortho",
    layout: (nodes, edges) => autoLayoutFlow(nodes, edges),
    sample: () => chain(5),
  },
  {
    id: "fishbone",
    icon: "🐟",
    label: "Espinha de Peixe",
    desc: "Diagrama de causa-efeito (Ishikawa)",
    routing: null,
    edgeStyle: "fishbone",
    layout: (nodes, edges, rootId) => autoLayoutFishbone(nodes, edges, rootId),
    sample: () => star(6),
  },
  {
    id: "timeline",
    icon: "📅",
    label: "Linha do Tempo",
    desc: "Sequência horizontal com marcos alternados acima/abaixo",
    routing: null,
    edgeStyle: "timeline",
    layout: (nodes, edges, rootId) => autoLayoutTimeline(nodes, edges, rootId),
    sample: () => chain(5),
  },
  {
    id: "grid",
    icon: "⊞",
    label: "Grade",
    desc: "Todos os nós em grade uniforme, ideal para coleções",
    routing: "ortho",
    layout: (nodes) => autoLayoutGrid(nodes),
    sample: () => gridSample(11),
  },
];

export function presetById(id: LayoutPresetId | undefined): LayoutPreset | undefined {
  return id ? PRESETS.find((preset) => preset.id === id) : undefined;
}

/** Eixo da linha do tempo: meio entre as duas fileiras (ou o padrão). */
export function timelineAxisY(nodes: MNode[]): number {
  if (nodes.length === 0) return TIMELINE_AXIS_Y;
  const ys = nodes.map((n) => n.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  return min === max ? TIMELINE_AXIS_Y : (min + max) / 2;
}

/** Caminho da conexão segundo o modelo (usado quando a aresta não tem geometria própria). */
export function presetEdgePath(
  preset: LayoutPreset,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  axisY = TIMELINE_AXIS_Y,
): string {
  if (preset.edgeStyle === "fishbone") return fishboneEdgePath(x1, y1, x2, y2);
  if (preset.edgeStyle === "timeline") return timelineEdgePath(x1, y1, x2, y2, axisY);
  return edgePath(x1, y1, x2, y2, preset.routing ?? "curve");
}

export interface PresetDecoration {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Linhas de fundo que dão o desenho característico (espinha / eixo). */
export function presetDecoration(preset: LayoutPreset | undefined, nodes: MNode[]): PresetDecoration[] {
  if (!preset || nodes.length === 0) return [];
  if (preset.edgeStyle === "fishbone") {
    const spineY = nodes[0].y;
    const minX = Math.min(...nodes.map((n) => n.x)) - LAYOUT_METRICS.nodeWidth / 2 - 40;
    return [{ x1: minX, y1: spineY, x2: nodes[0].x, y2: spineY }];
  }
  if (preset.edgeStyle === "timeline") {
    const axisY = timelineAxisY(nodes);
    const xs = nodes.map((n) => n.x);
    return [{ x1: Math.min(...xs) - 80, y1: axisY, x2: Math.max(...xs) + 80, y2: axisY }];
  }
  return [];
}

/**
 * Projeta coordenadas de mundo numa caixa (usada pela miniatura do card).
 * O fator e os deslocamentos saem do próprio resultado do layout, por isso a
 * figura é literalmente o resultado do modelo, só reduzido.
 */
export interface Projector {
  x: (value: number) => number;
  y: (value: number) => number;
}

export function projectorFor(nodes: MNode[], width: number, height: number, padding = 8): Projector {
  const halfW = LAYOUT_METRICS.nodeWidth / 2;
  const halfH = LAYOUT_METRICS.nodeHeight / 2;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - halfW;
  const maxX = Math.max(...xs) + halfW;
  const minY = Math.min(...ys) - halfH;
  const maxY = Math.max(...ys) + halfH;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return {
    x: (value) => offsetX + (value - minX) * scale,
    y: (value) => offsetY + (value - minY) * scale,
  };
}

/** Distância entre marcos alternados (exposta para os testes do modelo). */
export const TIMELINE_ROW_OFFSET = TIMELINE_OFFSET;
