import { describe, expect, it } from "vitest";
import { LAYOUT_METRICS, autoLayoutHierarchical, autoLayoutOrgChart, autoLayoutTree } from "./layout";
import { mkEdge, mkNode } from "./model";
import type { MEdge, MNode } from "./model";

const node = (id: string, x = 0, y = 0): MNode => ({ ...mkNode(id, "", x, y, 0), id });
const byId = (nodes: MNode[]) => new Map(nodes.map((n) => [n.id, n]));

/** Duas caixas centradas se sobrepõem quando os eixos não estão separados. */
function expectNoOverlap(nodes: MNode[]) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const separated =
        Math.abs(a.x - b.x) >= LAYOUT_METRICS.nodeWidth || Math.abs(a.y - b.y) >= LAYOUT_METRICS.nodeHeight;
      expect(separated, `${a.id} sobrepõe ${b.id}`).toBe(true);
    }
  }
}

/** Raiz com três filhos, cada um com dois netos: faixas de mesmo tamanho. */
function balancedTree() {
  const nodes = [
    node("R"),
    node("A", -100),
    node("B", 0),
    node("C", 100),
    node("A1"),
    node("A2"),
    node("B1"),
    node("B2"),
    node("C1"),
    node("C2"),
  ];
  const edges: MEdge[] = [
    mkEdge("R", "A"),
    mkEdge("R", "B"),
    mkEdge("R", "C"),
    mkEdge("A", "A1"),
    mkEdge("A", "A2"),
    mkEdge("B", "B1"),
    mkEdge("B", "B2"),
    mkEdge("C", "C1"),
    mkEdge("C", "C2"),
  ];
  return { nodes, edges };
}

describe("autoLayoutHierarchical (organograma)", () => {
  it("centraliza o pai sobre os filhos e não sobrepõe caixas", () => {
    const { nodes, edges } = balancedTree();
    const out = autoLayoutOrgChart(nodes, edges, "R");
    expectNoOverlap(out);

    const m = byId(out);
    expect(m.get("R")!.x).toBe(500);
    expect(m.get("R")!.y).toBe(100);

    // Nível 1 alinhado e com passo vertical previsível.
    const level1 = ["A", "B", "C"].map((id) => m.get(id)!);
    expect(level1[0].y).toBeCloseTo(100 + LAYOUT_METRICS.nodeHeight + LAYOUT_METRICS.gapY);
    expect(level1.every((n) => n.y === level1[0].y)).toBe(true);
    expect(m.get("R")!.x).toBeCloseTo((level1[0].x + level1[2].x) / 2);

    // Cada pai fica no meio dos dois filhos.
    for (const [parent, kids] of [
      ["A", ["A1", "A2"]],
      ["B", ["B1", "B2"]],
      ["C", ["C1", "C2"]],
    ] as const) {
      const p = m.get(parent)!;
      const k = kids.map((id) => m.get(id)!);
      expect(p.x).toBeCloseTo((k[0].x + k[1].x) / 2);
    }

    // A raiz fica no centro da caixa dos descendentes.
    const leaves = ["A1", "A2", "B1", "B2", "C1", "C2"].map((id) => m.get(id)!);
    const xs = leaves.map((l) => l.x);
    expect(m.get("R")!.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2);
  });

  it("mantém irmãos de subárvores desiguais separados", () => {
    const nodes = [
      node("R"),
      node("A", -200),
      node("B", 0),
      node("C", 200),
      ...[1, 2, 3, 4, 5, 6].map((i) => node(`A${i}`)),
      node("B1"),
    ];
    const edges: MEdge[] = [
      mkEdge("R", "A"),
      mkEdge("R", "B"),
      mkEdge("R", "C"),
      ...[1, 2, 3, 4, 5, 6].map((i) => mkEdge("A", `A${i}`)),
      mkEdge("B", "B1"),
    ];
    const out = autoLayoutOrgChart(nodes, edges, "R");
    expectNoOverlap(out);

    // A ordem atual dos ramos é preservada, mesmo com faixas de tamanhos diferentes.
    const m = byId(out);
    expect(m.get("A")!.x).toBeLessThan(m.get("B")!.x);
    expect(m.get("B")!.x).toBeLessThan(m.get("C")!.x);
  });

  it("é idempotente: reaplicar não move nada", () => {
    const { nodes, edges } = balancedTree();
    const once = autoLayoutOrgChart(nodes, edges, "R");
    const twice = autoLayoutOrgChart(once, edges, "R");
    expect(twice).toEqual(once);
  });

  it("coloca nós fora da hierarquia numa faixa abaixo, sem sobrepor", () => {
    const nodes = [node("R"), node("A"), node("Orfao1", 900, 900), node("Orfao2", 950, 950)];
    const edges = [mkEdge("R", "A")];
    const out = autoLayoutOrgChart(nodes, edges, "R");
    expectNoOverlap(out);

    const m = byId(out);
    expect(m.get("Orfao1")!.y).toBeGreaterThan(m.get("A")!.y);
    expect(m.get("Orfao1")!.y).toBe(m.get("Orfao2")!.y);
  });

  it("lida com entrada vazia e com raiz isolada", () => {
    expect(autoLayoutOrgChart([], [])).toEqual([]);
    expect(autoLayoutHierarchical([node("R")], [], "R")[0]).toMatchObject({ x: 500, y: 100 });
  });
});

describe("autoLayoutHierarchical (árvore horizontal)", () => {
  it("cresce para a direita e centraliza o pai na vertical", () => {
    const { nodes, edges } = balancedTree();
    const out = autoLayoutTree(nodes, edges, "R");
    expectNoOverlap(out);

    const m = byId(out);
    expect(m.get("R")!.x).toBe(100);
    expect(m.get("R")!.y).toBe(380);
    expect(m.get("A")!.x).toBeCloseTo(100 + LAYOUT_METRICS.nodeWidth + LAYOUT_METRICS.gapX);
    expect(m.get("R")!.y).toBeCloseTo((m.get("A")!.y + m.get("C")!.y) / 2);
    expect(m.get("A1")!.x).toBeGreaterThan(m.get("A")!.x);
  });
});
