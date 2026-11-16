import { describe, it, expect, beforeEach, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  ...fsMock,
  BaseDirectory: { AppLocalData: "appLocalData" },
}));

import { uid, clamp, mkNode, mkEdge, childrenOf, parentOf, descendants, type MEdge } from "./core/model";
import { createMap } from "./core/templates";
import { loadWs, loadWsAsync, saveWs, onSaveState, markWorkspacePersisted, onStorageFull } from "./storage/workspace";
import { autoLayoutRadial, autoLayoutGrid, autoLayoutFlow, autoLayoutTimeline, autoLayoutOrgChart, autoLayoutTree } from "./core/layout";

// ── uid ────────────────────────────────────────────────────────────
describe("uid", () => {
  it("gera id unico por chamada", () => {
    const a = uid("n");
    const b = uid("n");
    expect(a).not.toBe(b);
  });

  it("tem prefixo customizavel", () => {
    expect(uid("map").startsWith("map_")).toBe(true);
    expect(uid("e").startsWith("e_")).toBe(true);
  });

  it("many calls: 1000 ids unicos em sequencia", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(uid("t"));
    expect(set.size).toBe(1000);
  });
});

// ── clamp ───────────────────────────────────────────────────────────
describe("clamp", () => {
  it("limita dentro de faixa [lo,hi]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

// ── Hierarchy helpers ───────────────────────────────────────────────
describe("descendants", () => {
  it("retorna set vazio para no sem filhos", () => {
    const edges: MEdge[] = [];
    const result = descendants("noA", edges);
    expect(result.size).toBe(0);
  });

  it("coleta descendentes transitivos", () => {
    // A -> B -> C
    // A -> D
    const edges = [mkEdge("A", "B"), mkEdge("B", "C"), mkEdge("A", "D")];
    const result = descendants("A", edges);
    expect(result.size).toBe(3);
    expect(result.has("B")).toBe(true);
    expect(result.has("C")).toBe(true);
    expect(result.has("D")).toBe(true);
  });

  it("NAO estoura com ciclo (defensivo)", () => {
    // A -> B -> C -> A  (ciclo)
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const edges = [mkEdge("A", "B"), mkEdge("B", "C"), mkEdge("C", "A")];
    expect(() => descendants("A", edges)).not.toThrow();
    // Apenas B (primeiro filho) deve aparecer — C->A e' pulado por ser parent ja visitado
    const result = descendants("A", edges);
    expect(result.has("B")).toBe(true);
    expect(result.has("C")).toBe(true);
    // Nao deve conter ele mesmo (A): nao se visita raiz
    expect(result.has("A")).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe("childrenOf / parentOf", () => {
  it("childrenOf retorna lista de alvos", () => {
    const edges = [mkEdge("A", "B"), mkEdge("A", "C"), mkEdge("X", "Y")];
    const kids = childrenOf("A", edges);
    expect(kids).toHaveLength(2);
    expect(kids).toContain("B");
    expect(kids).toContain("C");
  });

  it("parentOf retorna null quando nao tem pai", () => {
    const edges = [mkEdge("A", "B")];
    expect(parentOf("A", edges)).toBeNull();
    expect(parentOf("B", edges)).toBe("A");
  });
});

// ── Templates / createMap ───────────────────────────────────────────
describe("createMap", () => {
  it("gera mapa valido com todos os templates", () => {
    const templates = [
      "Modelo A", "Radial", "Hierarquico", "Fluxograma", "Arvore",
      "Arvore Direita", "Arvore Esquerda", "Organograma",
      "Espinha de Peixe", "Livre", "Kanban", "Timeline",
    ] as const;
    for (const t of templates) {
      const m = createMap("Teste " + t, t);
      expect(m.id).toBeTruthy();
      expect(m.title).toBe("Teste " + t);
      expect(m.template).toBe(t);
      expect(m.nodes.length).toBeGreaterThan(0);
      expect(m.edges.length).toBeGreaterThanOrEqual(0);
      // Todos os nos tem campos obrigatorios
      for (const n of m.nodes) {
        expect(typeof n.id).toBe("string");
        expect(typeof n.title).toBe("string");
        expect(Number.isFinite(n.x)).toBe(true);
        expect(Number.isFinite(n.y)).toBe(true);
        expect(typeof n.tone).toBe("number");
      }
    }
  });
});

// ── Persistence ─────────────────────────────────────────────────────
describe("loadWs / saveWs", () => {
  const tauriWindow = window as typeof window & { __TAURI__?: unknown };
  const fileContents = new Map<string, string>();
  beforeEach(() => {
    localStorage.clear();
    delete tauriWindow.__TAURI__;
    fsMock.exists.mockReset();
    fsMock.readTextFile.mockReset();
    fsMock.writeTextFile.mockReset();
    fsMock.rename.mockReset();
    fileContents.clear();
    fsMock.exists.mockImplementation(async (path: string) => fileContents.has(path));
    fsMock.readTextFile.mockImplementation(async (path: string) => {
      if (!fileContents.has(path)) throw new Error(`Missing file ${path}`);
      return fileContents.get(path)!;
    });
    fsMock.writeTextFile.mockImplementation(async (path: string, value: string) => { fileContents.set(path, value); });
    fsMock.rename.mockImplementation(async (from: string, to: string) => {
      const contents = fileContents.get(from);
      if (contents === undefined) throw new Error(`Missing file ${from}`);
      fileContents.set(to, contents);
      fileContents.delete(from);
    });
  });

  it("loadWs retorna workspace default quando storage vazio", () => {
    const ws = loadWs();
    expect(ws.maps).toHaveLength(1);
    expect(ws.maps[0].title).toBe("Meu Primeiro Mapa");
    expect(ws.active).toBe(ws.maps[0].id);
  });

  it("inicia a homologação com um mapa vazio quando habilitada", () => {
    tauriWindow.__TAURI__ = {};
    const ws = loadWs();
    expect(ws.maps).toHaveLength(1);
    if (import.meta.env.VITE_APAMIND_HOMOLOGACAO === "1") {
      expect(ws.maps[0].nodes).toEqual([]);
      expect(ws.maps[0].edges).toEqual([]);
    } else {
      expect(ws.maps[0].nodes.length).toBeGreaterThan(0);
    }
  });

  it("saveWs + loadWs roundtrip preserva estado", async () => {
    const ws = loadWs();
    await saveWs(ws);
    const ws2 = loadWs();
    expect(ws2.maps.length).toBe(ws.maps.length);
    expect(ws2.active).toBe(ws.active);
    expect(ws2.maps[0].title).toBe(ws.maps[0].title);
  });

  it("não escreve novamente um snapshot já confirmado quando a fila está ociosa", async () => {
    const ws = loadWs();
    markWorkspacePersisted(ws);
    const setItem = vi.spyOn(Object.getPrototypeOf(localStorage), "setItem");
    try {
      const result = await saveWs(ws);
      expect(result.success).toBe(true);
      expect(setItem).not.toHaveBeenCalled();
    } finally { setItem.mockRestore(); }
  });

  it("migra v5 para v6 por cópia verificada e mantém v5 intacta", () => {
    // Simula dados gravados por versao pre-migracao (sem schemaVersion, com campos faltantes)
    const legacyMap = {
      id: "map_legacy_1",
      title: "Mapa antigo",
      template: "Livre",
      ts: "2024-01-01T00:00:00.000Z",
      nodes: [
        { id: "n1", title: "Raiz", note: "", x: 100, y: 200, tone: 0, shape: "card" },
        { id: "n2", title: "Filho", note: "", x: 300, y: 200, tone: 1, shape: "rect" },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    const legacyRaw = JSON.stringify({ active: "map_legacy_1", maps: [legacyMap] });
    localStorage.setItem("apamind.v5", legacyRaw);
    const ws = loadWs();
    expect(ws.maps).toHaveLength(1);
    expect(ws.maps[0].title).toBe("Mapa antigo");
    // Migracao preenche schemaVersion
    expect(ws.maps[0].schemaVersion).toBe(1);
    expect(localStorage.getItem("apamind.v5")).toBe(legacyRaw);
    expect(JSON.parse(localStorage.getItem("apamind.v6")!).maps[0].id).toBe("map_legacy_1");
  });

  it("não cria workspace vazio nem altera v6 inválido", () => {
    const invalid = "{ this is not real JSON }}}";
    localStorage.setItem("apamind.v6", invalid);
    expect(() => loadWs()).toThrow(/JSON inválido/);
    expect(localStorage.getItem("apamind.v6")).toBe(invalid);
  });

  it("não escolhe automaticamente entre v5 e v6 divergentes", () => {
    const make = (title: string) => ({ active: "m", maps: [{ id: "m", title, template: "Livre", ts: "x", nodes: [], edges: [] }] });
    const v5 = JSON.stringify(make("antigo"));
    const v6 = JSON.stringify(make("novo"));
    localStorage.setItem("apamind.v5", v5);
    localStorage.setItem("apamind.v6", v6);
    expect(() => loadWs()).toThrow(/divergem/);
    expect(localStorage.getItem("apamind.v5")).toBe(v5);
    expect(localStorage.getItem("apamind.v6")).toBe(v6);
  });

  it("não substitui v6 inválido por cópia v5 válida", () => {
    const invalid = "not json";
    localStorage.setItem("apamind.v5", JSON.stringify({ active: "m", maps: [{ id: "m", title: "legado", template: "Livre", ts: "x", nodes: [], edges: [] }] }));
    localStorage.setItem("apamind.v6", invalid);
    expect(() => loadWs()).toThrow(/JSON inválido/);
    expect(localStorage.getItem("apamind.v6")).toBe(invalid);
  });

  it("não cria v6 se workspace.json diverge de v5", async () => {
    tauriWindow.__TAURI__ = {};
    const v5 = JSON.stringify({ active: "m", maps: [{ id: "m", title: "local", template: "Livre", ts: "x", nodes: [], edges: [] }] });
    const file = JSON.stringify({ active: "f", maps: [{ id: "f", title: "arquivo", template: "Livre", ts: "y", nodes: [], edges: [] }] });
    localStorage.setItem("apamind.v5", v5);
    fsMock.exists.mockResolvedValue(true);
    fsMock.readTextFile.mockResolvedValue(file);
    await expect(loadWsAsync()).rejects.toThrow(/divergem/);
    expect(localStorage.getItem("apamind.v5")).toBe(v5);
    expect(localStorage.getItem("apamind.v6")).toBeNull();
  });

  it("não ignora workspace.json inválido nem migra v5 antes de reportar", async () => {
    tauriWindow.__TAURI__ = {};
    const v5 = JSON.stringify({ active: "m", maps: [{ id: "m", title: "local", template: "Livre", ts: "x", nodes: [], edges: [] }] });
    localStorage.setItem("apamind.v5", v5);
    fsMock.exists.mockResolvedValue(true);
    fsMock.readTextFile.mockResolvedValue("broken-json");
    await expect(loadWsAsync()).rejects.toThrow(/JSON inválido/);
    expect(localStorage.getItem("apamind.v5")).toBe(v5);
    expect(localStorage.getItem("apamind.v6")).toBeNull();
  });

  it("mantém workspace.json como principal e impede cache divergente de sobrescrevê-lo", async () => {
    tauriWindow.__TAURI__ = {};
    const local = { active: "l", maps: [{ id: "l", title: "cache", template: "Livre", ts: "x", nodes: [], edges: [] }] };
    const main = { active: "m", maps: [{ id: "m", title: "principal", template: "Livre", ts: "y", nodes: [], edges: [] }] };
    localStorage.setItem("apamind.v6", JSON.stringify(local));
    fileContents.set("workspace.json", JSON.stringify(main));
    await expect(loadWsAsync()).rejects.toThrow(/divergem/);
    expect(JSON.parse(fileContents.get("workspace.json")!).maps[0].title).toBe("principal");
  });

  it("grava snapshots desktop em sequência e mantém o último workspace íntegro", async () => {
    tauriWindow.__TAURI__ = {};
    const first = { active: "a", maps: [{ id: "a", title: "primeiro", template: "Livre" as const, ts: "x", nodes: [], edges: [] }] };
    const second = { active: "b", maps: [{ id: "b", title: "segundo", template: "Livre" as const, ts: "y", nodes: [], edges: [] }] };
    const writes: string[] = [];
    fsMock.writeTextFile.mockImplementation(async (path: string, value: string) => {
      writes.push(path);
      await new Promise(resolve => setTimeout(resolve, 2));
      fileContents.set(path, value);
    });
    const results = await Promise.all([saveWs(first), saveWs(second)]);
    expect(results.every(result => result.success)).toBe(true);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(fileContents.get("workspace.json")!).maps[0].title).toBe("segundo");
  });

  it("falha em uma gravação não contamina a fila seguinte", async () => {
    tauriWindow.__TAURI__ = {};
    fileContents.set("workspace.json", JSON.stringify({ active: "old", maps: [{ id: "old", title: "preservado", template: "Livre", ts: "x", nodes: [], edges: [] }] }));
    let shouldFail = true;
    fsMock.writeTextFile.mockImplementation(async (path: string, value: string) => {
      if (shouldFail) { shouldFail = false; throw new Error("disco indisponível"); }
      fileContents.set(path, value);
    });
    const first = await saveWs({ active: "a", maps: [{ id: "a", title: "falha", template: "Livre", ts: "x", nodes: [], edges: [] }] });
    const second = await saveWs({ active: "b", maps: [{ id: "b", title: "sucesso", template: "Livre", ts: "y", nodes: [], edges: [] }] });
    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    expect(JSON.parse(fileContents.get("workspace.json")!).maps[0].title).toBe("sucesso");
  });

  it("mantém o arquivo anterior se a gravação do temporário falhar", async () => {
    tauriWindow.__TAURI__ = {};
    const previous = JSON.stringify({ active: "old", maps: [{ id: "old", title: "intacto", template: "Livre", ts: "x", nodes: [], edges: [] }] });
    fileContents.set("workspace.json", previous);
    fsMock.writeTextFile.mockRejectedValueOnce(new Error("interrupção durante escrita"));
    const result = await saveWs({ active: "new", maps: [{ id: "new", title: "novo", template: "Livre", ts: "y", nodes: [], edges: [] }] });
    expect(result.success).toBe(false);
    expect(fileContents.get("workspace.json")).toBe(previous);
    expect(fsMock.rename).not.toHaveBeenCalled();
  });

  it("mantém o arquivo anterior se a releitura do temporário falhar na validação", async () => {
    tauriWindow.__TAURI__ = {};
    const previous = JSON.stringify({ active: "old", maps: [{ id: "old", title: "intacto", template: "Livre", ts: "x", nodes: [], edges: [] }] });
    fileContents.set("workspace.json", previous);
    fsMock.readTextFile.mockImplementation(async (path: string) => {
      if (path.includes(".tmp-")) return "truncated-json";
      return fileContents.get(path)!;
    });
    const result = await saveWs({ active: "new", maps: [{ id: "new", title: "novo", template: "Livre", ts: "y", nodes: [], edges: [] }] });
    expect(result.success).toBe(false);
    expect(fileContents.get("workspace.json")).toBe(previous);
    expect(fsMock.rename).not.toHaveBeenCalled();
  });

  it("publica estado de erro para a interface quando a fonte principal falha", async () => {
    tauriWindow.__TAURI__ = {};
    fsMock.writeTextFile.mockRejectedValueOnce(new Error("sem espaço"));
    const states: string[] = [];
    const unsubscribe = onSaveState((state, error) => states.push(`${state}:${error ?? ""}`));
    try {
      const result = await saveWs({ active: "m", maps: [{ id: "m", title: "mapa", template: "Livre", ts: "x", nodes: [], edges: [] }] });
      expect(result.success).toBe(false);
      expect(states.map(s => s.split(":")[0])).toEqual(["saving", "error"]);
      expect(states[1]).toContain("sem espaço");
    } finally { unsubscribe(); }
  });

  it("migrateWorkspace preenche fields opcionais ausentes", () => {
    const legacyMap = {
      id: "m1",
      title: "Map antigo",
      template: "Livre",
      ts: "2024-01-01T00:00:00.000Z",
      nodes: [
        // note faltando propositadamente — deve virar ""
        { id: "n1", title: "Sem nota", x: 0, y: 0, tone: 0, shape: "card" } as any,
      ],
      edges: [],
    };
    localStorage.setItem("apamind.v6", JSON.stringify({ active: "m1", maps: [legacyMap] }));
    const ws = loadWs();
    expect(ws.maps[0].nodes[0].note).toBe("");
    expect(ws.maps[0].nodes[0].shape).toBe("card");
  });
});

// ── saveWs em QuotaExceeded ─────────────────────────────────────────
describe("onStorageFull", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("dispara callback quando localStorage.setItem falha", async () => {
    // jsdom mantem setItem em Storage.prototype; spy na instancia nao intercepta.
    const proto = Object.getPrototypeOf(localStorage);
    const spy = vi.spyOn(proto, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    let called = false;
    const off = onStorageFull(() => { called = true; });
    try {
      await saveWs(loadWs());
      expect(called).toBe(true);
    } finally {
      off();
      spy.mockRestore();
    }
  });
});

// ── Layouts ─────────────────────────────────────────────────────────
describe("autoLayoutRadial", () => {
  it("retorna nodes inalterados quando entrada eh vazia", () => {
    const out = autoLayoutRadial([], []);
    expect(out).toEqual([]);
  });

  it("retorna nodes inalterados quando root nao tem filhos", () => {
    const n = mkNode("Raiz", "", 0, 0, 0, "card");
    const out = autoLayoutRadial([n], []);
    expect(out).toHaveLength(1);
    // Raiz deve estar em (500, 380)
    expect(out[0].x).toBe(500);
    expect(out[0].y).toBe(380);
  });

  it("nao retorna NaN para kids.length === 0", () => {
    const root = mkNode("Raiz", "", 0, 0, 0, "capsule");
    const out = autoLayoutRadial([root], []);
    expect(Number.isFinite(out[0].x)).toBe(true);
    expect(Number.isFinite(out[0].y)).toBe(true);
  });

  it("distribui filhos em circulo", () => {
    const root = mkNode("Raiz", "", 0, 0, 0, "capsule");
    const k1 = mkNode("A", "", 0, 0, 1, "card");
    const k2 = mkNode("B", "", 0, 0, 2, "card");
    const k3 = mkNode("C", "", 0, 0, 3, "card");
    const edges = [mkEdge(root.id, k1.id), mkEdge(root.id, k2.id), mkEdge(root.id, k3.id)];
    const out = autoLayoutRadial([root, k1, k2, k3], edges, root.id);
    expect(out).toHaveLength(4);
    // Distancia radial dos Kids deve ser ~280 de (500, 380)
    for (let i = 1; i < 4; i++) {
      const dx = (out[i].x) - 500;
      const dy = (out[i].y) - 380;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(280, -2);
    }
  });
});

describe("autoLayoutGrid", () => {
  it("retorna array vazio para entrada vazia", () => {
    const out = autoLayoutGrid([]);
    expect(out).toEqual([]);
  });

  it("distribui 9 nodes em grid (provavelmente 4 cols)", () => {
    const ns = Array.from({ length: 9 }, (_, i) => mkNode(`N${i}`, "", 0, 0, 0, "card"));
    const out = autoLayoutGrid(ns);
    expect(out).toHaveLength(9);
    // Todos devem ter coords finitos e nao-zero (depois de 120)
    for (const n of out) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(120);
      expect(n.y).toBeGreaterThanOrEqual(120);
    }
  });
});

describe("autoLayoutTree / autoLayoutOrgChart (protecao de ciclo)", () => {
  it("NAO estoura com edges em ciclo", () => {
    const root = mkNode("R", "", 0, 0, 0, "capsule");
    const a = mkNode("A", "", 0, 0, 1, "card");
    const b = mkNode("B", "", 0, 0, 2, "card");
    // Ciclo: R -> A -> B -> A
    const edges = [mkEdge(root.id, a.id), mkEdge(a.id, b.id), mkEdge(b.id, a.id)];
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => autoLayoutTree([root, a, b], edges, root.id)).not.toThrow();
    expect(() => autoLayoutOrgChart([root, a, b], edges, root.id)).not.toThrow();
    consoleSpy.mockRestore();
  });
});

describe("autoLayoutFlow / autoLayoutTimeline (protecao de ciclo)", () => {
  it("Flow nao estoura em ciclo encadeado", () => {
    const a = mkNode("A", "", 0, 0, 0, "card");
    const b = mkNode("B", "", 0, 0, 1, "card");
    const c = mkNode("C", "", 0, 0, 2, "card");
    // A -> B -> C -> A  (volta ao inicio)
    const edges = [mkEdge(a.id, b.id), mkEdge(b.id, c.id), mkEdge(c.id, a.id)];
    expect(() => autoLayoutFlow([a, b, c], edges)).not.toThrow();
  });

  it("Timeline nao estoura em ciclo", () => {
    const a = mkNode("A", "", 0, 0, 0, "card");
    const b = mkNode("B", "", 0, 0, 1, "card");
    const c = mkNode("C", "", 0, 0, 2, "card");
    const edges = [mkEdge(a.id, b.id), mkEdge(b.id, c.id), mkEdge(c.id, a.id)];
    expect(() => autoLayoutTimeline([a, b, c], edges)).not.toThrow();
  });
});
