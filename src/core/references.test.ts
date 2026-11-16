import { describe, expect, it } from "vitest";
import type { Attachment } from "./model";
import { mkNode } from "./model";
import { createMap } from "./templates";
import { mapReferenceTarget, remapMapReferences, collectBrokenMapLinks } from "./references";

function mapWithAttachment(attachment: Attachment) {
  const map = createMap("m", "Livre");
  const node = mkNode("n", "", 0, 0, 0, "card", { attachments: [attachment] });
  return { ...map, nodes: [node], edges: [] };
}

describe("mapReferenceTarget", () => {
  it("extrai o id de uma referência map://", () => {
    expect(mapReferenceTarget("map://abc-123")).toBe("abc-123");
  });

  it("retorna null para caminhos que não são referências internas", () => {
    expect(mapReferenceTarget("https://exemplo.com")).toBeNull();
    expect(mapReferenceTarget("C:\\Users\\map.pdf")).toBeNull();
    expect(mapReferenceTarget("map://")).toBeNull();
  });
});

describe("remapMapReferences", () => {
  it("reescreve map://<antigo> para o id novo correspondente", () => {
    const map = mapWithAttachment({ id: "a1", type: "map", name: "Outro mapa", path: "map://OLD" });
    const out = remapMapReferences(map, new Map([["OLD", "NEW"]]));
    expect(out.nodes[0].attachments?.[0].path).toBe("map://NEW");
  });

  it("não altera anexos que não são referências internas", () => {
    const map = mapWithAttachment({ id: "a2", type: "url", name: "site", path: "https://exemplo.com" });
    const out = remapMapReferences(map, new Map([["OLD", "NEW"]]));
    expect(out.nodes[0].attachments?.[0].path).toBe("https://exemplo.com");
  });

  it("mantém intacta a referência sem correspondência no mapeamento", () => {
    const map = mapWithAttachment({ id: "a3", type: "map", name: "perdido", path: "map://DESCONHECIDO" });
    const out = remapMapReferences(map, new Map([["OUTRO", "NOVO"]]));
    expect(out.nodes[0].attachments?.[0].path).toBe("map://DESCONHECIDO");
  });

  it("preserva os demais campos do nó e do mapa", () => {
    const map = mapWithAttachment({ id: "a4", type: "map", name: "x", path: "map://OLD" });
    const out = remapMapReferences(map, new Map([["OLD", "NEW"]]));
    expect(out.id).toBe(map.id);
    expect(out.title).toBe(map.title);
    expect(out.nodes[0].title).toBe("n");
    expect(out.nodes[0].attachments?.[0].name).toBe("x");
  });
});

describe("collectBrokenMapLinks", () => {
  it("detecta referências internas cujo alvo não existe", () => {
    const a = createMap("A", "Livre");
    const b = createMap("B", "Livre");
    const node = mkNode("n", "", 0, 0, 0, "card", {
      attachments: [{ id: "x", type: "map", name: "perdido", path: "map://INEXISTENTE" }],
    });
    const linked = { ...b, nodes: [...b.nodes, node] };

    const broken = collectBrokenMapLinks([a, linked]);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ mapId: b.id, nodeId: "n", attachmentId: "x", targetId: "INEXISTENTE" });
  });

  it("não reporta referências válidas", () => {
    const a = createMap("A", "Livre");
    const b = createMap("B", "Livre");
    const node = mkNode("n", "", 0, 0, 0, "card", {
      attachments: [{ id: "x", type: "map", name: "ok", path: `map://${a.id}` }],
    });
    const linked = { ...b, nodes: [...b.nodes, node] };

    expect(collectBrokenMapLinks([a, linked])).toHaveLength(0);
  });
});
