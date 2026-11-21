import type { MMap } from "../../core/model";
import { edgeSegments } from "../../core/geometry";
import { download, roundRect, safeName } from "./files";

// ── Export PNG ────────────────────────────────────────────────────
export function exportPNG(map: MMap, themeDark = true) {
  if (!map.nodes.length) return;
  const pad = 80;
  const xs = map.nodes.map((n) => n.x),
    ys = map.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad,
    maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad,
    maxY = Math.max(...ys) + pad;
  const w = maxX - minX || 1,
    h = maxY - minY || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = themeDark ? "#080a12" : "#f5f2ec";
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  map.edges.forEach((e) => {
    const s = map.nodes.find((n) => n.id === e.source);
    const t = map.nodes.find((n) => n.id === e.target);
    if (!s || !t) return;
    ctx.beginPath();
    ctx.strokeStyle = themeDark ? "rgba(165,180,252,0.5)" : "rgba(79,70,229,0.4)";
    ctx.lineWidth = 2;
    ctx.moveTo(s.x - minX, s.y - minY);
    // Mesmos segmentos do canvas/exportadores: o PNG nao pode divergir da tela.
    for (const segment of edgeSegments(s.x, s.y, t.x, t.y, e.routing)) {
      if (segment.kind === "line") {
        ctx.lineTo(segment.x - minX, segment.y - minY);
      } else {
        ctx.bezierCurveTo(
          segment.c1x - minX,
          segment.c1y - minY,
          segment.c2x - minX,
          segment.c2y - minY,
          segment.x - minX,
          segment.y - minY,
        );
      }
    }
    ctx.stroke();
  });

  map.nodes.forEach((n) => {
    const rx = n.shape === "circle" ? 50 : 60;
    const ry = n.shape === "circle" ? 50 : 32;
    ctx.fillStyle = themeDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";
    ctx.strokeStyle = themeDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)";
    ctx.lineWidth = 1;
    roundRect(ctx, n.x - rx - minX, n.y - ry - minY, rx * 2, ry * 2, n.shape === "circle" ? rx : 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = themeDark ? "#e2e8f0" : "#1e293b";
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.title, n.x - minX, n.y - minY);
  });

  canvas.toBlob((blob) => {
    if (blob) download(blob, `${safeName(map.title)}.png`);
  });
}
