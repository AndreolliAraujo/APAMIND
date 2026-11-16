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
    links: [{ label: "Reference site", url: "https://docs.example.com/topic?q=1#part" }],
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
  it("roundtrips JSON maps with relationships, notes, links, attachments, and map metadata", async () => {
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
      links: original.nodes[1].links,
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

  it("roundtrips a full backup with links and local attachments", async () => {
    const original = sampleMap();
    const backupText = serializeWorkspaceBackup([original]);
    const result = await importWorkspaceBackup(file("apamind_backup.json", backupText));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maps).toHaveLength(1);
    expect(result.maps[0].nodes[1].links).toEqual(original.nodes[1].links);
    expect(result.maps[0].nodes[1].attachments).toEqual(original.nodes[1].attachments);
    const fileImport = await importFile(file("apamind_backup.json", backupText));
    expect(fileImport.ok && fileImport.kind).toBe("backup");
  });

  it.each([
    ["invalid JSON syntax", "map.json", "{"],
    ["invalid node relationship", "map.json", JSON.stringify({ ...sampleMap(), edges: [{ id: "edge-x", source: "missing", target: "also-missing" }] })],
    ["invalid attachment shape", "map.json", JSON.stringify({ ...sampleMap(), nodes: [{ ...sampleMap().nodes[0], attachments: [{ type: "url", path: 42 }] }], edges: [] })],
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
    expect(await importFile(file("wrong.mm", "<html><body>not a FreeMind map</body></html>"))).toMatchObject({ ok: false });
    expect(await importFile(file("broken.opml", "<opml><body>"))).toMatchObject({ ok: false });
    expect(() => importFreeMind("<not-a-map/>" )).toThrow(/nó raiz/i);
    expect(() => importMindMeister("<not-opml/>" )).toThrow(/outline/i);
  });

  it("imports supported Markdown, FreeMind, OPML, and XMind inputs", async () => {
    const markdown = await importFile(file("outline.md", "# Root\n## Child"));
    expect(markdown).toMatchObject({ ok: true, kind: "map" });
    if (markdown.ok && markdown.kind === "map") expect(markdown.map.edges).toHaveLength(1);

    const freeMind = await importFile(file("outline.mm", '<map version="1.0.1"><node TEXT="Root"><node TEXT="Child"/></node></map>'));
    expect(freeMind).toMatchObject({ ok: true, kind: "map" });

    const opml = await importFile(file("outline.opml", '<opml><body><outline text="Root"><outline text="Child"/></outline></body></opml>'));
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

  it("validates imported map relationships and nested link/attachment structure", () => {
    const invalid = { ...sampleMap(), nodes: [{ ...sampleMap().nodes[0], links: [{ url: 5, label: "bad" }] }] };
    expect(validateMMap(invalid)).toMatchObject({ ok: false });
  });
});
