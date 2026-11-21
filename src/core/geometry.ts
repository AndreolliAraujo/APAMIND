// Geometria pura usada pelo canvas e pelos exportadores.
//
// `edgeSegments` é a única fonte de verdade do desenho da conexão: o SVG do
// canvas, o export SVG/HTML/print e o desenho em canvas do PNG consomem os
// mesmos segmentos, então a geometria nunca diverge entre a tela e o arquivo.

import type { EdgeRouting } from "./model";

export type EdgeSegment =
  | { kind: "line"; x: number; y: number }
  | { kind: "cubic"; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number };

/**
 * Segmentos da conexão de (x1, y1) a (x2, y2).
 * - curve: Bézier horizontal com controle em (cx, y1) e (cx, y2) — desenho historico.
 * - straight: reta direta entre as pontas.
 * - ortho: cotovelo. O eixo é escolhido pelo deslocamento dominante
 *   (|dx| >= |dy| => sai na horizontal, senão sai na vertical), que é o que
 *   faz o organograma/árvore descerem limpos e o fluxo/mindmap seguirem de lado.
 */
export function edgeSegments(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  routing: EdgeRouting = "curve",
): EdgeSegment[] {
  if (routing === "straight") return [{ kind: "line", x: x2, y: y2 }];
  if (routing === "ortho") {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const midX = (x1 + x2) / 2;
      return [
        { kind: "line", x: midX, y: y1 },
        { kind: "line", x: midX, y: y2 },
        { kind: "line", x: x2, y: y2 },
      ];
    }
    const midY = (y1 + y2) / 2;
    return [
      { kind: "line", x: x1, y: midY },
      { kind: "line", x: x2, y: midY },
      { kind: "line", x: x2, y: y2 },
    ];
  }
  const cx = (x1 + x2) / 2;
  return [{ kind: "cubic", c1x: cx, c1y: y1, c2x: cx, c2y: y2, x: x2, y: y2 }];
}

/** Atributo `d` do <path> para a geometria escolhida. */
export function edgePath(x1: number, y1: number, x2: number, y2: number, routing: EdgeRouting = "curve") {
  let d = `M ${x1} ${y1}`;
  for (const s of edgeSegments(x1, y1, x2, y2, routing)) {
    d += s.kind === "line" ? ` L ${s.x} ${s.y}` : ` C ${s.c1x} ${s.c1y}, ${s.c2x} ${s.c2y}, ${s.x} ${s.y}`;
  }
  return d;
}
