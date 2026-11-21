import type { MMap } from "../../core/model";
import { edgePath } from "../../core/geometry";
import { esc } from "./files";
import { minimalDocument } from "./minimalMarkup";

// ── Print ─────────────────────────────────────────────────────────
export function printMap(map: MMap, themeDark = true) {
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

  if (map.template === "Minimalista") {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (win) {
      win.document.write(minimalDocument(map, { minX, minY, width: w, height: h, print: true }));
      win.document.close();
    }
    return;
  }

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(map.title)}</title><style>
    @media print{body{margin:0}}
    body{margin:0;background:${bg};font-family:sans-serif}
    #c{position:relative;width:${w}px;height:${h}px;margin:0 auto}
    .n{position:absolute;transform:translate(-50%,-50%);padding:10px 16px;border-radius:14px;background:${themeDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)"};border:1px solid ${themeDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"};color:${text};font-size:13px;font-weight:600;white-space:nowrap}
    svg{position:absolute;left:0;top:0;width:100%;height:100%}
  </style></head><body onload="window.print();setTimeout(()=>window.close(),500)"><div id="c">`;

  html += `<svg>`;
  map.edges.forEach((e) => {
    const s = map.nodes.find((n) => n.id === e.source);
    const t = map.nodes.find((n) => n.id === e.target);
    if (!s || !t) return;
    html += `<path d="${edgePath(s.x - minX, s.y - minY, t.x - minX, t.y - minY, e.routing)}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`;
  });
  html += `</svg>`;
  map.nodes.forEach((n) => {
    html += `<div class="n" style="left:${n.x - minX}px;top:${n.y - minY}px">${esc(n.title)}</div>`;
  });
  html += `</div></body></html>`;

  const win = window.open("", "_blank", "noopener,noreferrer");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
