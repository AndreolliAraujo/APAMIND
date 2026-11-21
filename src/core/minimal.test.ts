import { describe, expect, it } from "vitest";
import { mkEdge, mkNode, type MNode } from "./model";
import { createMap } from "./templates";
import {
  MINIMAL_NODE_WIDTH,
  minimalEdgeFor,
  minimalEdgePath,
  minimalEdgeShape,
  minimalHiddenCount,
  minimalNodeHeight,
  minimalTextBlock,
  minimalUnderlineY,
  wrapMinimalText,
} from "./minimal";

const node = (id: string, x: number, y: number, title = id, note = ""): MNode => ({
  ...mkNode(title, note, x, y, 0),
  id,
});

describe("minimal: medição de texto", () => {
  it("quebra o título em linhas e cresce com o texto", () => {
    const short = node("a", 0, 0, "Curto");
    const long = node("b", 0, 0, "Um título bem comprido que precisa de várias linhas para caber no bloco");
    expect(minimalNodeHeight(long)).toBeGreaterThan(minimalNodeHeight(short));
    expect(minimalTextBlock(long).title.length).toBeGreaterThan(1);
  });

  it("mantém a linha de sublinhado sempre abaixo do texto", () => {
    for (const title of ["A", "Título de duas linhas com bastante texto", "x".repeat(120), "y".repeat(200)]) {
      const n = node("n", 100, 200, title, "nota curta");
      const bottom = n.y + minimalNodeHeight(n) / 2;
      expect(minimalUnderlineY(n)).toBeGreaterThan(bottom);
    }
  });

  it("limita a nota a duas linhas com reticências", () => {
    const n = node("n", 0, 0, "Título", "uma nota longa ".repeat(20));
    const lines = minimalTextBlock(n).note;
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[lines.length - 1]).toContain("…");
  });

  it("trunca palavras quando excede o limite de linhas", () => {
    expect(wrapMinimalText("a b c d e f", 10, 1)).toEqual(["a b c d e…"]);
  });
});

describe("minimal: geometria da linha", () => {
  const root = node("root", 600, 380, "Raiz");

  it("detecta o lado pela posição atual do destino", () => {
    const right = node("r", 940, 420);
    const left = node("l", 260, 420);
    expect(minimalEdgeShape(root, root, right).side).toBe("right");
    expect(minimalEdgeShape(root, root, left).side).toBe("left");
    // Arrastar o nó para o outro lado espelha a linha e a ponta.
    expect(minimalEdgeShape(root, root, { ...right, x: 100 }).side).toBe("left");
  });

  it("sai da lateral da raiz no nível 1 e termina sob o texto com reta horizontal", () => {
    const child = node("c", 940, 420, "Filho");
    const shape = minimalEdgeShape(root, root, child);
    const d = minimalEdgePath(shape);

    expect(shape.start.y).toBe(root.y);
    expect(shape.start.x).toBeGreaterThan(root.x);
    expect(shape.inner.x).toBeCloseTo(child.x - MINIMAL_NODE_WIDTH / 2);
    expect(shape.outer.x).toBeCloseTo(child.x + MINIMAL_NODE_WIDTH / 2);
    expect(shape.outer.y).toBeCloseTo(minimalUnderlineY(child));
    expect(d).toContain(" C ");
    expect(d.endsWith(`L ${shape.outer.x} ${shape.outer.y}`)).toBe(true);
  });

  it("no nível 2+ parte da ponta circular do pai imediato", () => {
    const parent = node("p", 940, 380);
    const child = node("c", 1240, 500);
    const shape = minimalEdgeShape(root, parent, child);
    expect(shape.start.x).toBeCloseTo(parent.x + MINIMAL_NODE_WIDTH / 2);
    expect(shape.start.y).toBeCloseTo(minimalUnderlineY(parent));
    // A reta fica estritamente sob o filho, não sob o pai.
    expect(shape.inner.y).toBeCloseTo(minimalUnderlineY(child));
  });

  it("espelha o traçado no lado esquerdo", () => {
    const child = node("c", 260, 420, "Filho");
    const shape = minimalEdgeShape(root, root, child);
    expect(shape.inner.x).toBeCloseTo(child.x + MINIMAL_NODE_WIDTH / 2);
    expect(shape.outer.x).toBeCloseTo(child.x - MINIMAL_NODE_WIDTH / 2);
    expect(shape.start.x).toBeLessThan(root.x);
  });

  it("encontra a aresta no mapa e conta os sub-itens recolhidos", () => {
    const map = createMap("Mini", "Minimalista");
    const edge = map.edges[0];
    expect(minimalEdgeFor(map, edge)).not.toBeNull();
    const parentId = edge.source;
    expect(minimalHiddenCount(parentId, map.edges)).toBe(4);
  });

  it("devolve null para aresta órfã", () => {
    const map = createMap("Mini", "Minimalista");
    expect(minimalEdgeFor(map, mkEdge("nao-existe", map.nodes[0].id))).toBeNull();
  });
});
