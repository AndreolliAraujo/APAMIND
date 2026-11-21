import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { mkEdge, mkNode } from "./core/model";
import { createMap } from "./core/templates";
import { validateMMap } from "./core/validation";
import { importFile, importFreeMind, importMindMeister, importWorkspaceBackup, importXMind } from "./storage/import";
import { serializeMapJSON, serializeWorkspaceBackup } from "./storage/export";

function sampleMap() {
  const root = mkNode("Research", "Overview", 100, 120, 0, "capsule");
  const child = mkNode("References", "A useful note", 260, 180, 2, "rect", {
    markdown: "**Keep this text**",
    checklist: [{ text: "Review source", done: true }],
    attachments: [
      { id: "att-url", type: "url", name: "Web docs", path: "https://docs.example.com/topic?q=1#part" },
      { id: "att-pdf", type: "pdf", name: "Local PDF", path: "C:\\Users\\Ana\\guide.pdf" },
    ],
  });
  return {
    ...createMap("Research map", "Livre"),
    schemaVersion: 6,
    nodes: [root, child],
    edges: [mkEdge(root.id, child.id, "dashed")],
    collapsedIds: [child.id],
  };
}

const file = (name: string, contents: string | Uint8Array) => {
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  const snapshot = bytes.slice();
  return {
    name,
    size: snapshot.byteLength,
    text: async () => new TextDecoder().decode(snapshot),
    arrayBuffer: async () => snapshot.slice().buffer as ArrayBuffer,
  } as File;
};

describe("importação e exportação", () => {
  it("roundtrips JSON maps with relationships, notes, attachments, and map metadata", async () => {
    const original = sampleMap();
    const result = await importFile(file("research.apamind.json", serializeMapJSON(original)));

    expect(result).toMatchObject({ ok: true, kind: "map" });
    if (!result.ok || result.kind !== "map") return;
    const imported = result.map;
    expect(imported.id).not.toBe(original.id);
    expect(imported.title).toBe(original.title);
    expect(imported.template).toBe(original.template);
    expect(imported.schemaVersion).toBe(original.schemaVersion);
    expect(imported.nodes[1]).toMatchObject({
      title: original.nodes[1].title,
      note: original.nodes[1].note,
      markdown: original.nodes[1].markdown,
      checklist: original.nodes[1].checklist,
      attachments: original.nodes[1].attachments,
    });
    expect(imported.nodes[1].id).not.toBe(original.nodes[1].id);
    expect(imported.edges).toHaveLength(1);
    expect(imported.edges[0]).toMatchObject({
      source: imported.nodes[0].id,
      target: imported.nodes[1].id,
      style: "dashed",
    });
    expect(imported.collapsedIds).toEqual([imported.nodes[1].id]);
  });

  it("roundtrips a full backup with local attachments", async () => {
    const original = sampleMap();
    const backupText = serializeWorkspaceBackup([original]);
    const result = await importWorkspaceBackup(file("apamind_backup.json", backupText));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maps).toHaveLength(1);
    expect(result.maps[0].nodes[1].attachments).toEqual(original.nodes[1].attachments);
    const fileImport = await importFile(file("apamind_backup.json", backupText));
    expect(fileImport.ok && fileImport.kind).toBe("backup");
  });

  it("remaps internal map references (map://) when restoring a multi-map backup", async () => {
    const a = sampleMap();
    const b = createMap("Mapa B", "Livre");
    const refer = mkNode("refer", "", 0, 0, 0, "card", {
      attachments: [{ id: "att-map", type: "map", name: "Mapa A", path: `map://${a.id}` }],
    });
    b.nodes = [...b.nodes, refer];

    const result = await importWorkspaceBackup(file("backup.json", serializeWorkspaceBackup([a, b])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const importedA = result.maps.find((m) => m.title === a.title);
    const importedB = result.maps.find((m) => m.title === "Mapa B");
    expect(importedA).toBeDefined();
    expect(importedB).toBeDefined();

    const referNode = importedB!.nodes.find((n) => n.title === "refer");
    expect(referNode).toBeDefined();
    expect(referNode!.attachments![0].path).toBe(`map://${importedA!.id}`);
  });

  it.each([
    ["invalid JSON syntax", "map.json", "{"],
    [
      "invalid node relationship",
      "map.json",
      JSON.stringify({ ...sampleMap(), edges: [{ id: "edge-x", source: "missing", target: "also-missing" }] }),
    ],
    [
      "invalid attachment shape",
      "map.json",
      JSON.stringify({
        ...sampleMap(),
        nodes: [{ ...sampleMap().nodes[0], attachments: [{ type: "url", path: 42 }] }],
        edges: [],
      }),
    ],
  ])("rejects %s without returning an importable map", async (_name, filename, contents) => {
    const result = await importFile(file(filename, contents));
    expect(result).toMatchObject({ ok: false });
  });

  it("reports unsupported file types clearly", async () => {
    expect(await importFile(file("notes.pdf", "not an import format"))).toEqual({
      ok: false,
      error: "Tipo de arquivo não suportado.",
    });
  });

  it("reports malformed XML and well-formed XML without a supported root instead of creating a placeholder map", async () => {
    expect(await importFile(file("broken.mm", "<map><node>"))).toMatchObject({ ok: false });
    expect(await importFile(file("wrong.mm", "<html><body>not a FreeMind map</body></html>"))).toMatchObject({
      ok: false,
    });
    expect(await importFile(file("broken.opml", "<opml><body>"))).toMatchObject({ ok: false });
    expect(() => importFreeMind("<not-a-map/>")).toThrow(/nó raiz/i);
    expect(() => importMindMeister("<not-opml/>")).toThrow(/outline/i);
  });

  it("imports supported Markdown, FreeMind, OPML, and XMind inputs", async () => {
    const markdown = await importFile(file("outline.md", "# Root\n## Child"));
    expect(markdown).toMatchObject({ ok: true, kind: "map" });
    if (markdown.ok && markdown.kind === "map") expect(markdown.map.edges).toHaveLength(1);

    const freeMind = await importFile(
      file("outline.mm", '<map version="1.0.1"><node TEXT="Root"><node TEXT="Child"/></node></map>'),
    );
    expect(freeMind).toMatchObject({ ok: true, kind: "map" });

    const opml = await importFile(
      file("outline.opml", '<opml><body><outline text="Root"><outline text="Child"/></outline></body></opml>'),
    );
    expect(opml).toMatchObject({ ok: true, kind: "map" });

    const contentJson = JSON.stringify({ rootTopic: { title: "Root", children: { attached: [{ title: "Child" }] } } });
    const xmindZip = zipSync({ "content.json": strToU8(contentJson) });
    const xmind = await importXMind(file("outline.xmind", xmindZip));
    expect(xmind).toMatchObject({ ok: true });
    if (xmind.ok) expect(xmind.map.edges).toHaveLength(1);
  });

  it("rejects XMind files that are not valid archives or contain no topics", async () => {
    expect(await importXMind(file("broken.xmind", "not a zip"))).toMatchObject({ ok: false });
    const emptyZip = zipSync({ "content.json": strToU8(JSON.stringify({ metadata: {} })) });
    expect(await importXMind(file("empty.xmind", emptyZip))).toMatchObject({ ok: false });
  });

  it("preserva a geometria da conexão na importação e recusa routing desconhecido", async () => {
    const routed = sampleMap();
    routed.edges[0].routing = "ortho";
    const imported = await importFile(file("routing.apamind.json", serializeMapJSON(routed)));
    expect(imported).toMatchObject({ ok: true, kind: "map" });
    if (!imported.ok || imported.kind !== "map") return;
    expect(imported.map.edges[0].routing).toBe("ortho");

    const broken = sampleMap();
    (broken.edges[0] as { routing?: string }).routing = "zigzag";
    expect(validateMMap(broken).ok).toBe(false);
  });

  it("aceita e preserva o template Minimalista na importação", async () => {
    const minimal = createMap("Minimal", "Minimalista");
    const imported = await importFile(file("minimal.apamind.json", serializeMapJSON(minimal)));
    expect(imported).toMatchObject({ ok: true, kind: "map" });
    if (!imported.ok || imported.kind !== "map") return;
    expect(imported.map.template).toBe("Minimalista");
    expect(imported.map.nodes).toHaveLength(5);
  });

  it("preserva o modelo de organização aplicado e descarta valor desconhecido", async () => {
    const organised = { ...sampleMap(), layoutPreset: "timeline" as const };
    const imported = await importFile(file("preset.apamind.json", serializeMapJSON(organised)));
    expect(imported).toMatchObject({ ok: true, kind: "map" });
    if (!imported.ok || imported.kind !== "map") return;
    expect(imported.map.layoutPreset).toBe("timeline");

    const unknown = { ...sampleMap(), layoutPreset: "zigzag" } as unknown as Parameters<typeof validateMMap>[0];
    const validated = validateMMap(unknown);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.map.layoutPreset).toBeUndefined();
  });

  it("migrates the deprecated links field into url attachments", () => {
    const legacy = {
      ...sampleMap(),
      nodes: [{ ...sampleMap().nodes[0], links: [{ url: "https://legacy.example.com/doc", label: "Legado" }] }],
      edges: [],
    };
    const result = validateMMap(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.map.nodes[0] as unknown as Record<string, unknown>;
    expect(node.links).toBeUndefined();
    const attachments = node.attachments as { type: string; path: string; name: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ type: "url", path: "https://legacy.example.com/doc", name: "Legado" });
  });
});
