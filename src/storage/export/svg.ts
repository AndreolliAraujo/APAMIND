import type { MMap } from "../../core/model";
import { edgePath } from "../../core/geometry";
import {
  MINIMAL_COLORS,
  MINIMAL_NODE_WIDTH,
  minimalEdgeFor,
  minimalEdgePath,
  minimalTextBlock,
} from "../../core/minimal";
import { download, esc, safeName } from "./files";

// ── Export SVG ────────────────────────────────────────────────────
function exportMinimalSVG(map: MMap) {
  const pad = 100;
  const xs = map.nodes.map((n) => n.x);
  const ys = map.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const root = map.nodes[0];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX} ${minY} ${w} ${h}">`;
  svg += `<rect width="100%" height="100%" fill="${MINIMAL_COLORS.background}"/>`;

  map.edges.forEach((edge) => {
    const shape = minimalEdgeFor(map, edge);
    if (!shape) return;
    svg += `<path d="${minimalEdgePath(shape)}" fill="none" stroke="${MINIMAL_COLORS.accent}" stroke-width="2" stroke-linecap="round"/>`;
    svg += `<circle cx="${shape.outer.x}" cy="${shape.outer.y}" r="8" fill="${MINIMAL_COLORS.background}" stroke="${MINIMAL_COLORS.accent}" stroke-width="2"/>`;
  });

  map.nodes.forEach((node) => {
    const isRoot = node.id === root.id;
    const block = minimalTextBlock(node);
    const x = isRoot ? node.x : node.x - MINIMAL_NODE_WIDTH / 2 + 8;
    const anchor = isRoot ? "middle" : "start";
    block.title.forEach((line, i) => {
      svg += `<text x="${x}" y="${block.titleBaseline + i * block.lineHeightTitle}" text-anchor="${anchor}" font-family="sans-serif" font-size="${isRoot ? 24 : 14}" font-weight="${isRoot ? 700 : 500}" fill="${isRoot ? MINIMAL_COLORS.accent : MINIMAL_COLORS.text}">${esc(line)}</text>`;
    });
    block.note.forEach((line, i) => {
      svg += `<text x="${x}" y="${block.noteBaseline + i * block.lineHeightNote}" text-anchor="${anchor}" font-family="sans-serif" font-size="12" fill="${MINIMAL_COLORS.note}">${esc(line)}</text>`;
    });
  });

  svg += `</svg>`;
  download(new Blob([svg], { type: "image/svg+xml" }), `${safeName(map.title)}.svg`);
}

export function exportSVG(map: MMap, themeDark = true) {
  if (!map.nodes.length) return;
  if (map.template === "Minimalista") {
    exportMinimalSVG(map);
    return;
  }
  const pad = 80;
  const xs = map.nodes.map((n) => n.x);
  const ys = map.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad,
    maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad,
    maxY = Math.max(...ys) + pad;
  const w = maxX - minX || 1,
    h = maxY - minY || 1;
  const bg = themeDark ? "#080a12" : "#f5f2ec";
  const text = themeDark ? "#e2e8f0" : "#1e293b";
  const stroke = themeDark ? "rgba(165,180,252,0.5)" : "rgba(79,70,229,0.4)";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX} ${minY} ${w} ${h}">`;
  svg += `<rect width="100%" height="100%" fill="${bg}"/>`;

  map.edges.forEach((e) => {
    const s = map.nodes.find((n) => n.id === e.source);
    const t = map.nodes.find((n) => n.id === e.target);
    if (!s || !t) return;
    svg += `<path d="${edgePath(s.x, s.y, t.x, t.y, e.routing)}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`;
  });

  map.nodes.forEach((n) => {
    const r = n.shape === "circle" ? 50 : 60;
    const ry = n.shape === "circle" ? 50 : 32;
    svg += `<rect x="${n.x - r}" y="${n.y - ry}" width="${r * 2}" height="${ry * 2}" rx="${n.shape === "circle" ? r : 14}" fill="${themeDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)"}" stroke="${themeDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}" stroke-width="1"/>`;
    svg += `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" fill="${text}" font-size="13" font-family="sans-serif" font-weight="600">${esc(n.title)}</text>`;
  });

  svg += `</svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  download(blob, `${safeName(map.title)}.svg`);
}
