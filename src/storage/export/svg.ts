import type { MMap } from "../../core/model";
import { edgePath } from "../../core/geometry";
import { download, esc, safeName } from "./files";

// ── Export SVG ────────────────────────────────────────────────────
export function exportSVG(map: MMap, themeDark = true) {
  if (!map.nodes.length) return;
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
    svg += `<path d="${edgePath(s.x, s.y, t.x, t.y)}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`;
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
