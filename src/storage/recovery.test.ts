import { describe, expect, it } from "vitest";
import { createMap } from "../core/templates";
import { parseStoredWorkspace, WorkspaceFutureVersionError } from "./recovery";

function validWorkspace() {
  const map = createMap("Mapa", "Livre");
  return { active: map.id, maps: [map] };
}

describe("parseStoredWorkspace", () => {
  it("aceita um workspace válido", () => {
    const ws = validWorkspace();
    const parsed = parseStoredWorkspace(JSON.stringify(ws), "teste");
    expect(parsed.maps).toHaveLength(1);
    expect(parsed.maps[0].title).toBe("Mapa");
  });

  it("recusa JSON inválido", () => {
    expect(() => parseStoredWorkspace("{", "teste")).toThrow(/JSON inválido/);
  });

  it("recusa nó sem id", () => {
    const ws = validWorkspace();
    const broken = { ...ws, maps: [{ ...ws.maps[0], nodes: [{ ...ws.maps[0].nodes[0], id: "" }] }] };
    expect(() => parseStoredWorkspace(JSON.stringify(broken), "teste")).toThrow(/estruturais inválidos/);
  });

  it("recusa aresta com origem inexistente", () => {
    const ws = validWorkspace();
    const broken = {
      ...ws,
      maps: [{ ...ws.maps[0], edges: [{ id: "e1", source: "nao-existe", target: ws.maps[0].nodes[0].id }] }],
    };
    expect(() => parseStoredWorkspace(JSON.stringify(broken), "teste")).toThrow(/estruturais inválidos/);
  });

  it("recusa id de nó duplicado", () => {
    const ws = validWorkspace();
    const original = ws.maps[0].nodes[0];
    const broken = { ...ws, maps: [{ ...ws.maps[0], nodes: [original, { ...original }] }] };
    expect(() => parseStoredWorkspace(JSON.stringify(broken), "teste")).toThrow(/estruturais inválidos/);
  });

  it("recusa versão futura sem rebaixar o formato", () => {
    const ws = validWorkspace();
    const future = { ...ws, maps: [{ ...ws.maps[0], schemaVersion: 2 }] };
    const raw = JSON.stringify(future);
    expect(() => parseStoredWorkspace(raw, "teste")).toThrow(WorkspaceFutureVersionError);
    expect(() => parseStoredWorkspace(raw, "teste")).toThrow(/versão mais recente/);
    // a entrada não é alterada
    expect(raw).toBe(JSON.stringify(future));
  });
});
