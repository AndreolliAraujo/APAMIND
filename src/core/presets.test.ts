import { describe, expect, it } from "vitest";
import { LAYOUT_METRICS } from "./layout";
import { PRESETS, presetById, presetDecoration, presetEdgePath, projectorFor, timelineAxisY } from "./presets";
import { createMap } from "./templates";
import type { LayoutPresetId, MNode } from "./model";

const preset = (id: LayoutPresetId) => {
  const found = presetById(id);
  if (!found) throw new Error(`preset ausente: ${id}`);
  return found;
};

function expectNoOverlap(nodes: MNode[], label: string) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const separated =
        Math.abs(a.x - b.x) >= LAYOUT_METRICS.nodeWidth || Math.abs(a.y - b.y) >= LAYOUT_METRICS.nodeHeight;
      expect(separated, `${label}: ${a.id} sobrepoe ${b.id}`).toBe(true);
    }
  }
}

describe("presets de organizacao", () => {
  it("posiciona todos os nos com coordenadas finitas", () => {
    for (const p of PRESETS) {
      const sample = p.sample();
      const out = p.layout(sample.nodes, sample.edges, sample.nodes[0]?.id);
      expect(out, p.id).toHaveLength(sample.nodes.length);
      for (const node of out) {
        expect(Number.isFinite(node.x) && Number.isFinite(node.y), p.id).toBe(true);
      }
    }
  });

  it("nao sobrepoe cartoes nos modelos redesenhados", () => {
    for (const id of ["org", "tree", "radial", "flow", "fishbone", "timeline", "grid"] as const) {
      const p = preset(id);
      const sample = p.sample();
      expectNoOverlap(p.layout(sample.nodes, sample.edges, sample.nodes[0]?.id), p.id);
    }
  });

  it("e idempotente: reaplicar nao move nada", () => {
    for (const p of PRESETS) {
      const sample = p.sample();
      const once = p.layout(sample.nodes, sample.edges, sample.nodes[0]?.id);
      const twice = p.layout(once, sample.edges, once[0]?.id);
      expect(
        twice.map((n) => [n.id, n.x, n.y]),
        p.id,
      ).toEqual(once.map((n) => [n.id, n.x, n.y]));
    }
  });

  it("desenha a espinha de peixe com espinha e bracos alternados", () => {
    const p = preset("fishbone");
    const sample = p.sample();
    const out = p.layout(sample.nodes, sample.edges, sample.nodes[0]?.id);
    const head = out[0];
    const arms = out.slice(1);

    // Metade dos bracos acima e metade abaixo da espinha.
    expect(arms.filter((n) => n.y < head.y)).toHaveLength(3);
    expect(arms.filter((n) => n.y > head.y)).toHaveLength(3);
    // Cada braco tem um par na mesma coluna, do outro lado.
    const columns = new Map<number, number>();
    for (const arm of arms) columns.set(arm.x, (columns.get(arm.x) ?? 0) + 1);
    expect([...columns.values()].every((count) => count === 2)).toBe(true);

    const [spine] = presetDecoration(p, out);
    expect(spine).toBeDefined();
    expect(spine.y1).toBe(head.y);
    expect(spine.y2).toBe(head.y);
    expect(Math.min(spine.x1, spine.x2)).toBeLessThan(Math.min(...arms.map((n) => n.x)));

    // Conexao do modelo: corre na espinha e desce/sobe ate a causa.
    const cause = arms[0];
    expect(presetEdgePath(p, head.x, head.y, cause.x, cause.y)).toBe(
      `M ${head.x} ${head.y} L ${cause.x} ${head.y} L ${cause.x} ${cause.y}`,
    );
  });

  it("desenha a linha do tempo com eixo e marcos alternados", () => {
    const p = preset("timeline");
    const sample = p.sample();
    const out = p.layout(sample.nodes, sample.edges, sample.nodes[0]?.id);
    const axis = timelineAxisY(out);

    out.forEach((node, i) => {
      expect(node.y < axis, `no ${i} deveria estar acima do eixo`).toBe(i % 2 === 0);
      expect(node.x).toBeCloseTo(120 + i * (LAYOUT_METRICS.nodeWidth + LAYOUT_METRICS.gapX));
    });

    const [axisLine] = presetDecoration(p, out);
    expect(axisLine).toBeDefined();
    expect(axisLine.y1).toBe(axis);
    expect(axisLine.y2).toBe(axis);

    const [first, second] = out;
    expect(presetEdgePath(p, first.x, first.y, second.x, second.y, axis)).toBe(
      `M ${first.x} ${first.y} L ${first.x} ${axis} L ${second.x} ${axis} L ${second.x} ${second.y}`,
    );
  });

  it("lê a hierarquia ao contrário quando as arestas apontam para a raiz", () => {
    // No template Espinha de Peixe as causas apontam para o problema.
    const map = createMap("Ishikawa", "Espinha de Peixe");
    const p = preset("fishbone");
    const out = p.layout(map.nodes, map.edges, map.nodes[0].id);
    const head = out[0];
    const arms = out.slice(1);
    expect(arms).toHaveLength(6);
    expect(arms.filter((n) => n.y < head.y)).toHaveLength(3);
    expect(arms.filter((n) => n.y > head.y)).toHaveLength(3);
    expectNoOverlap(out, "fishbone-reverso");
  });

  it("posiciona ramos mais fundos que os tres niveis classicos", () => {
    // Cadeia longa: o mapa mental precisa continuar a ramificação até o fim.
    const map = createMap("Cadeia", "Fluxograma");
    const p = preset("mindmap");
    const out = p.layout(map.nodes, map.edges, map.nodes[0].id);
    expectNoOverlap(out, "mindmap-cadeia");
    for (const node of out) expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
  });

  it("projeta a miniatura do card dentro da caixa", () => {
    for (const p of PRESETS) {
      const sample = p.sample();
      const out = p.layout(sample.nodes, sample.edges, sample.nodes[0]?.id);
      const project = projectorFor(out, 120, 80, 8);
      for (const node of out) {
        expect(project.x(node.x), p.id).toBeGreaterThanOrEqual(0);
        expect(project.x(node.x), p.id).toBeLessThanOrEqual(120);
        expect(project.y(node.y), p.id).toBeGreaterThanOrEqual(0);
        expect(project.y(node.y), p.id).toBeLessThanOrEqual(80);
      }
    }
  });
});
