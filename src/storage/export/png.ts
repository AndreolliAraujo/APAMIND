import type { MMap } from "../../core/model";
import { edgeSegments } from "../../core/geometry";
import { MINIMAL_COLORS, MINIMAL_NODE_WIDTH, minimalEdgeFor, minimalTextBlock } from "../../core/minimal";
import { download, roundRect, safeName } from "./files";

// ── Export PNG ────────────────────────────────────────────────────
/** Desenho do template Minimalista: texto puro, linhas sublinhadas e ponta circular. */
function drawMinimalPNG(ctx: CanvasRenderingContext2D, map: MMap, minX: number, minY: number, w: number, h: number) {
  ctx.fillStyle = MINIMAL_COLORS.background;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineWidth = 2;

  map.edges.forEach((edge) => {
    const shape = minimalEdgeFor(map, edge);
    if (!shape) return;
    ctx.beginPath();
    ctx.strokeStyle = MINIMAL_COLORS.accent;
    ctx.moveTo(shape.start.x - minX, shape.start.y - minY);
    ctx.bezierCurveTo(
      shape.c1.x - minX,
      shape.c1.y - minY,
      shape.c2.x - minX,
      shape.c2.y - minY,
      shape.inner.x - minX,
      shape.inner.y - minY,
    );
    ctx.lineTo(shape.outer.x - minX, shape.outer.y - minY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(shape.outer.x - minX, shape.outer.y - minY, 8, 0, Math.PI * 2);
    ctx.fillStyle = MINIMAL_COLORS.background;
    ctx.fill();
    ctx.strokeStyle = MINIMAL_COLORS.accent;
    ctx.stroke();
  });

  const root = map.nodes[0];
  ctx.textBaseline = "alphabetic";
  map.nodes.forEach((node) => {
    const isRoot = node.id === root.id;
    const block = minimalTextBlock(node);
    const centerX = node.x - minX;
    const leftX = centerX - MINIMAL_NODE_WIDTH / 2 + 8;
    ctx.textAlign = isRoot ? "center" : "left";
    block.title.forEach((line, i) => {
      ctx.font = isRoot ? "700 24px sans-serif" : "500 14px sans-serif";
      ctx.fillStyle = isRoot ? MINIMAL_COLORS.accent : MINIMAL_COLORS.text;
      ctx.fillText(line, isRoot ? centerX : leftX, block.titleBaseline + i * block.lineHeightTitle - minY);
    });
    block.note.forEach((line, i) => {
      ctx.font = "400 12px sans-serif";
      ctx.fillStyle = MINIMAL_COLORS.note;
      ctx.fillText(line, isRoot ? centerX : leftX, block.noteBaseline + i * block.lineHeightNote - minY);
    });
  });
}

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

  if (map.template === "Minimalista") {
    drawMinimalPNG(ctx, map, minX, minY, w, h);
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${safeName(map.title)}.png`);
    });
    return;
  }

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
