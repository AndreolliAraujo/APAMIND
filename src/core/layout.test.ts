import { describe, expect, it } from "vitest";
import {
  LAYOUT_METRICS,
  autoLayoutHierarchical,
  autoLayoutMinimal,
  autoLayoutOrgChart,
  autoLayoutTree,
} from "./layout";
import { MINIMAL_NODE_WIDTH, minimalNodeHeight } from "./minimal";
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

/** Duas caixas de texto do Minimalista se sobrepõem quando os eixos não separam. */
function minimalOverlap(a: MNode, b: MNode) {
  return (
    Math.abs(a.x - b.x) < MINIMAL_NODE_WIDTH && Math.abs(a.y - b.y) < (minimalNodeHeight(a) + minimalNodeHeight(b)) / 2
  );
}

describe("autoLayoutMinimal (bilateral)", () => {
  function bilateralTree() {
    const nodes = [
      node("R", 0, 0),
      node("A", 0, 10),
      node("B", 0, 20),
      node("C", 0, 30),
      node("D", 0, 40),
      node("A1", 0, 0),
      node("A2", 0, 0),
      node("B1", 0, 0),
    ];
    nodes[1] = { ...nodes[1], title: "Primeiro ramo com um título longo de três linhas para testar o espaçamento" };
    nodes[6] = { ...nodes[6], note: "nota curta de apoio" };
    const edges: MEdge[] = [
      mkEdge("R", "A"),
      mkEdge("R", "B"),
      mkEdge("R", "C"),
      mkEdge("R", "D"),
      mkEdge("A", "A1"),
      mkEdge("A", "A2"),
      mkEdge("B", "B1"),
    ];
    return { nodes, edges };
  }

  it("coloca a raiz no centro e alterna os ramos entre esquerda e direita", () => {
    const { nodes, edges } = bilateralTree();
    const m = byId(autoLayoutMinimal(nodes, edges, "R"));

    expect(m.get("R")).toMatchObject({ x: 600, y: 380 });
    expect(m.get("A")!.x).toBeGreaterThan(600);
    expect(m.get("B")!.x).toBeLessThan(600);
    expect(m.get("C")!.x).toBeGreaterThan(600);
    expect(m.get("D")!.x).toBeLessThan(600);
  });

  it("empurra cada nível para fora, no mesmo lado do ramo", () => {
    const { nodes, edges } = bilateralTree();
    const m = byId(autoLayoutMinimal(nodes, edges, "R"));
    expect(m.get("A1")!.x).toBeGreaterThan(m.get("A")!.x);
    expect(m.get("A2")!.x).toBe(m.get("A1")!.x);
    expect(m.get("B1")!.x).toBeLessThan(m.get("B")!.x);
  });

  it("não sobrepõe mesmo com título de várias linhas", () => {
    const { nodes, edges } = bilateralTree();
    const out = autoLayoutMinimal(nodes, edges, "R");
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(minimalOverlap(out[i], out[j]), `${out[i].id} sobrepoe ${out[j].id}`).toBe(false);
      }
    }
  });

  it("é idempotente", () => {
    const { nodes, edges } = bilateralTree();
    const once = autoLayoutMinimal(nodes, edges, "R");
    const twice = autoLayoutMinimal(once, edges, once[0].id);
    expect(twice.map((n) => [n.id, n.x, n.y])).toEqual(once.map((n) => [n.id, n.x, n.y]));
  });

  it("não estoura com ciclo e posiciona todos os nós", () => {
    const nodes = [node("R"), node("A"), node("B"), node("Ilha")];
    const edges = [mkEdge("R", "A"), mkEdge("A", "B"), mkEdge("B", "A")];
    const out = autoLayoutMinimal(nodes, edges, "R");
    expect(out).toHaveLength(4);
    for (const n of out) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });
});
