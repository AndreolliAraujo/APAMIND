import { describe, expect, it } from "vitest";
import { edgePath, edgeSegments } from "./geometry";

describe("edgePath", () => {
  it("preserva o desenho de curva historico como default", () => {
    expect(edgePath(100, 200, 300, 400)).toBe("M 100 200 C 200 200, 200 400, 300 400");
    expect(edgePath(100, 200, 300, 400, "curve")).toBe(edgePath(100, 200, 300, 400));
  });

  it("desenha reta entre as duas pontas", () => {
    expect(edgePath(100, 200, 300, 400, "straight")).toBe("M 100 200 L 300 400");
  });

  it("usa cotovelo horizontal quando o deslocamento em x domina", () => {
    expect(edgePath(100, 200, 300, 300, "ortho")).toBe("M 100 200 L 200 200 L 200 300 L 300 300");
  });

  it("usa cotovelo vertical quando o deslocamento em y domina", () => {
    expect(edgePath(100, 100, 150, 300, "ortho")).toBe("M 100 100 L 100 200 L 150 200 L 150 300");
  });

  it("desempata pelo eixo horizontal quando |dx| == |dy|", () => {
    expect(edgePath(0, 0, 100, 100, "ortho")).toBe("M 0 0 L 50 0 L 50 100 L 100 100");
  });
});

describe("edgeSegments", () => {
  it("descreve a curva com controles no meio horizontal", () => {
    expect(edgeSegments(0, 0, 100, 50)).toEqual([{ kind: "cubic", c1x: 50, c1y: 0, c2x: 50, c2y: 50, x: 100, y: 50 }]);
  });

  it("descreve a reta e o ortogonal sem curva", () => {
    expect(edgeSegments(0, 0, 100, 50, "straight")).toEqual([{ kind: "line", x: 100, y: 50 }]);
    expect(edgeSegments(0, 0, 100, 10, "ortho")).toEqual([
      { kind: "line", x: 50, y: 0 },
      { kind: "line", x: 50, y: 10 },
      { kind: "line", x: 100, y: 10 },
    ]);
  });

  it("e a fonte unica do edgePath: reconstruir pelos segmentos da a mesma string", () => {
    const routings = ["curve", "straight", "ortho"] as const;
    for (const routing of routings) {
      let rebuilt = "M 10 20";
      for (const segment of edgeSegments(10, 20, 210, 90, routing)) {
        rebuilt +=
          segment.kind === "line"
            ? ` L ${segment.x} ${segment.y}`
            : ` C ${segment.c1x} ${segment.c1y}, ${segment.c2x} ${segment.c2y}, ${segment.x} ${segment.y}`;
      }
      expect(edgePath(10, 20, 210, 90, routing)).toBe(rebuilt);
    }
  });
});
