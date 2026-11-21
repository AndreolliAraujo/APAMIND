// Geometria e medição de texto do template "Minimalista".
//
// Tudo aqui é puro (sem DOM) e usado por três consumidores: o layout bilateral
// (core/layout.ts), o canvas (App.tsx) e os exportadores. Assim a linha
// sublinhada, a ponta circular e a altura do texto não divergem entre a tela e
// os arquivos exportados.

import type { MEdge, MMap, MNode } from "./model";
import { descendants } from "./model";

/** Largura fixa do bloco de texto dos nós (a raiz é a única de largura livre). */
export const MINIMAL_NODE_WIDTH = 220;

/** Cores fixas do template (fonte única para canvas e exportadores). */
export const MINIMAL_COLORS = {
  background: "#F8FAFC",
  text: "#1E293B",
  note: "rgba(30,41,59,0.62)",
  accent: "#4F46E5",
  accentHover: "#4338CA",
} as const;
/** Distância do centro da raiz até o centro da primeira coluna. */
export const MINIMAL_LEVEL_1_OFFSET = 340;
/** Distância entre colunas de níveis consecutivos. */
export const MINIMAL_COLUMN_STEP = 300;
/** Respiro vertical entre faixas de subárvore. */
export const MINIMAL_VERTICAL_GAP = 32;

const TITLE_LINE_HEIGHT = 20;
const NOTE_LINE_HEIGHT = 16;
const PADDING_Y = 8;
const UNDERLINE_GAP = 8;
const TITLE_CHARS_PER_LINE = 28;
const NOTE_CHARS_PER_LINE = 34;

/** Quebra de texto por palavras, opcionalmente truncando com reticências. */
export function wrapMinimalText(text: string, perLine: number, maxLines = Number.POSITIVE_INFINITY): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || next.length <= perLine) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[kept.length - 1] = `${kept[kept.length - 1].slice(0, Math.max(1, perLine - 1))}…`;
    return kept;
  }
  return lines;
}

export function minimalTitleLines(node: MNode): string[] {
  return wrapMinimalText(node.title, TITLE_CHARS_PER_LINE);
}

/** A nota é curta por definição: no máximo duas linhas, como no canvas. */
export function minimalNoteLines(node: MNode): string[] {
  return node.note ? wrapMinimalText(node.note, NOTE_CHARS_PER_LINE, 2) : [];
}

/** Altura estimada do bloco de texto, em pixels. */
export function minimalNodeHeight(node: MNode): number {
  const titleLines = Math.max(1, minimalTitleLines(node).length);
  const noteLines = minimalNoteLines(node).length;
  return PADDING_Y + titleLines * TITLE_LINE_HEIGHT + (noteLines ? noteLines * NOTE_LINE_HEIGHT + 4 : 0);
}

/** Y da linha de sublinhado: sempre abaixo da última linha de texto. */
export function minimalUnderlineY(node: MNode, gap = UNDERLINE_GAP): number {
  return node.y + minimalNodeHeight(node) / 2 + gap;
}

/** Meia-largura estimada da raiz (ela não tem largura fixa). */
export function minimalRootHalfWidth(node: MNode): number {
  const width = Math.min(288, Math.max(140, node.title.trim().length * 13 + 24));
  return width / 2;
}

export interface MinimalEdgeShape {
  side: "left" | "right";
  /** Início: lateral da raiz (nível 1) ou ponta circular do pai (nível 2+). */
  start: { x: number; y: number };
  /** Ponta interna da linha reta (início do sublinhado). */
  inner: { x: number; y: number };
  /** Ponta externa, onde fica o círculo interativo. */
  outer: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
}

/**
 * Traçado do modelo: curva curta até a altura do sublinhado e reta horizontal
 * por toda a largura do bloco. O lado é decidido pela posição ATUAL do destino
 * em relação à raiz, então arrastar um nó de lado espelha linha e círculo.
 */
export function minimalEdgeShape(root: MNode, source: MNode, target: MNode): MinimalEdgeShape {
  const side: "left" | "right" = target.x < root.x ? "left" : "right";
  const dir = side === "right" ? 1 : -1;
  const yBase = minimalUnderlineY(target);
  const innerX = target.x - dir * (MINIMAL_NODE_WIDTH / 2);
  const outerX = target.x + dir * (MINIMAL_NODE_WIDTH / 2);

  const start =
    source.id === root.id
      ? { x: root.x + dir * minimalRootHalfWidth(root), y: root.y }
      : {
          x: source.x + (source.x < root.x ? -1 : 1) * (MINIMAL_NODE_WIDTH / 2),
          y: minimalUnderlineY(source),
        };

  const dx = innerX - start.x;
  return {
    side,
    start,
    inner: { x: innerX, y: yBase },
    outer: { x: outerX, y: yBase },
    c1: { x: start.x + dx * 0.35, y: start.y },
    c2: { x: innerX - dx * 0.25, y: yBase },
  };
}

/** Caminho completo: curva curta + reta sublinhando o texto. */
export function minimalEdgePath(shape: MinimalEdgeShape): string {
  const { start, c1, c2, inner, outer } = shape;
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${inner.x} ${inner.y} L ${outer.x} ${outer.y}`;
}

/** Apenas a reta do sublinhado — usada como área de clique, fora do texto. */
export function minimalEdgeHorizontal(shape: MinimalEdgeShape): string {
  return `M ${shape.inner.x} ${shape.inner.y} L ${shape.outer.x} ${shape.outer.y}`;
}

/** Geometria da aresta no mapa, ou null se as pontas não existirem. */
export function minimalEdgeFor(map: MMap, edge: MEdge): MinimalEdgeShape | null {
  const root = map.nodes[0];
  if (!root) return null;
  const source = map.nodes.find((n) => n.id === edge.source);
  const target = map.nodes.find((n) => n.id === edge.target);
  if (!source || !target) return null;
  return minimalEdgeShape(root, source, target);
}

/** Quantos nós ficam escondidos quando este ramo está recolhido. */
export function minimalHiddenCount(nodeId: string, edges: MEdge[]): number {
  return descendants(nodeId, edges).size;
}

export interface MinimalTextBlock {
  title: string[];
  note: string[];
  titleBaseline: number;
  noteBaseline: number;
  lineHeightTitle: number;
  lineHeightNote: number;
}

/**
 * Linhas e posições de base do texto de um nó — usadas pelos exportadores para
 * desenhar exatamente o mesmo bloco que o canvas mostra.
 */
export function minimalTextBlock(node: MNode): MinimalTextBlock {
  const title = minimalTitleLines(node);
  const note = minimalNoteLines(node);
  const top = node.y - minimalNodeHeight(node) / 2 + PADDING_Y / 2;
  const titleBaseline = top + 15;
  return {
    title,
    note,
    titleBaseline,
    noteBaseline: titleBaseline + title.length * TITLE_LINE_HEIGHT + 4,
    lineHeightTitle: TITLE_LINE_HEIGHT,
    lineHeightNote: NOTE_LINE_HEIGHT,
  };
}

/** Id estável para o círculo interativo (usado em testes e acessibilidade). */
export function minimalTipId(nodeId: string): string {
  return `minimal-tip-${nodeId}`;
}
