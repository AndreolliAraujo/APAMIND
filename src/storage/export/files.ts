// Helpers compartilhados dos exportadores.

// ── Helpers ───────────────────────────────────────────────────────
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  // Revoke tardio: alguns navegadores (Safari antigo) precisam da URL viva até o download iniciar
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeName(name: string) {
  return name.replace(/[^a-z0-9\u00C0-\u00FF\s-]/gi, "").trim().replace(/\s+/g, "-").slice(0, 48) || "mapa";
}

export function esc(s: string) {
  // Entidades HTML para escapar conteúdo/atributos em SVG, HTML, títulos
  const AMP = "&";
  const LT = "&" + "lt;";
  const GT = "&" + "gt;";
  const QUOT = "&" + "quot;";
  const APOS = "&#" + "39;";
  const BTICK = "&#" + "96;";
  return s
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT)
    .replace(/'/g, APOS)
    .replace(/`/g, BTICK);
}

// Escapa colchetes/parênteses para markdown seguro (evita quebra de links e js: scheme)
export function escMarkdownInline(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\]/g, "\\]")
    .replace(/\[/g, "\\[")
    .replace(/\)/g, "\\)")
    .replace(/\(/g, "\\(")
    .replace(/`/g, "\\`");
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
