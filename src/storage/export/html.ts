import type { MMap } from "../../core/model";
import { edgePath } from "../../core/geometry";
import { download, esc, safeName } from "./files";

// ── Export HTML interativo ────────────────────────────────────────
export function exportHTML(map: MMap, themeDark = true) {
  if (!map.nodes.length) return;
  const bg = themeDark ? "#080a12" : "#f5f2ec";
  const text = themeDark ? "#e2e8f0" : "#1e293b";
  const stroke = themeDark ? "rgba(165,180,252,0.5)" : "rgba(79,70,229,0.4)";
  const pad = 80;
  const xs = map.nodes.map((n) => n.x),
    ys = map.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad,
    maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad,
    maxY = Math.max(...ys) + pad;
  const w = maxX - minX || 1,
    h = maxY - minY || 1;

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(map.title)}</title><style>
    body{margin:0;background:${bg};font-family:sans-serif;overflow:auto}
    #c{position:relative;width:${w}px;height:${h}px;margin:20px auto}
    .n{position:absolute;transform:translate(-50%,-50%);padding:10px 16px;border-radius:14px;background:${themeDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)"};border:1px solid ${themeDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"};color:${text};font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.2);cursor:pointer;transition:transform .2s}
    .n:hover{transform:translate(-50%,-50%) scale(1.05)}
    svg{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
  </style></head><body><div id="c">`;

  html += `<svg>`;
  map.edges.forEach((e) => {
    const s = map.nodes.find((n) => n.id === e.source);
    const t = map.nodes.find((n) => n.id === e.target);
    if (!s || !t) return;
    html += `<path d="${edgePath(s.x - minX, s.y - minY, t.x - minX, t.y - minY)}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`;
  });
  html += `</svg>`;

  map.nodes.forEach((n) => {
    html += `<div class="n" style="left:${n.x - minX}px;top:${n.y - minY}px">${esc(n.title)}</div>`;
  });

  html += `</div></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  download(blob, `${safeName(map.title)}.html`);
}
