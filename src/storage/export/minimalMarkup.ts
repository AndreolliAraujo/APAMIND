// Marcação compartilhada pelos exports HTML e impressão do template Minimalista.
// Usa a mesma geometria e a mesma medição de texto do canvas.

import type { MMap } from "../../core/model";
import {
  MINIMAL_COLORS,
  MINIMAL_NODE_WIDTH,
  minimalEdgeFor,
  minimalEdgePath,
  minimalTextBlock,
} from "../../core/minimal";
import { esc } from "./files";

export function minimalMarkupCss(): string {
  return `
    .n{position:absolute;transform:translate(-50%,-50%);width:${MINIMAL_NODE_WIDTH}px;padding:4px 8px;text-align:left;font-family:sans-serif;font-size:14px;font-weight:500;line-height:20px;color:${MINIMAL_COLORS.text};overflow-wrap:break-word}
    .n .s{font-size:12px;line-height:16px;margin-top:4px;color:${MINIMAL_COLORS.note};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .n.root{width:auto;max-width:18rem;padding:8px 12px;text-align:center;font-size:24px;font-weight:700;color:${MINIMAL_COLORS.accent}}
  `;
}

/** Conexões (SVG) e nós (divs) posicionados em coordenadas de mundo. */
export function minimalMarkup(map: MMap, minX: number, minY: number): { svg: string; nodes: string } {
  const root = map.nodes[0];
  let paths = "";
  map.edges.forEach((edge) => {
    const shape = minimalEdgeFor(map, edge);
    if (!shape) return;
    paths += `<path d="${minimalEdgePath(shape)}" fill="none" stroke="${MINIMAL_COLORS.accent}" stroke-width="2" stroke-linecap="round"/>`;
    paths += `<circle cx="${shape.outer.x}" cy="${shape.outer.y}" r="8" fill="${MINIMAL_COLORS.background}" stroke="${MINIMAL_COLORS.accent}" stroke-width="2"/>`;
  });

  let nodes = "";
  map.nodes.forEach((node) => {
    const isRoot = node.id === root.id;
    const block = minimalTextBlock(node);
    nodes += `<div class="n${isRoot ? " root" : ""}" style="left:${node.x - minX}px;top:${node.y - minY}px">`;
    block.title.forEach((line) => {
      nodes += `<div>${esc(line)}</div>`;
    });
    block.note.forEach((line) => {
      nodes += `<div class="s">${esc(line)}</div>`;
    });
    nodes += `</div>`;
  });

  return { svg: `<svg><g transform="translate(${-minX},${-minY})">${paths}</g></svg>`, nodes };
}

export function minimalDocument(
  map: MMap,
  options: { minX: number; minY: number; width: number; height: number; print?: boolean },
): string {
  const { minX, minY, width, height, print = false } = options;
  const { svg, nodes } = minimalMarkup(map, minX, minY);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(map.title)}</title><style>
    ${print ? "@media print{body{margin:0}}" : ""}
    body{margin:0;background:${MINIMAL_COLORS.background};font-family:sans-serif;overflow:auto}
    #c{position:relative;width:${width}px;height:${height}px;margin:20px auto}
    ${minimalMarkupCss()}
    svg{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
  </style></head><body${print ? ' onload="window.print();setTimeout(()=>window.close(),500)"' : ""}><div id="c">${svg}${nodes}</div></body></html>`;
}
