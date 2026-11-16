import { describe, expect, it } from "vitest";
import { mkEdge, mkNode } from "./core/model";
import { createMap } from "./core/templates";
import {
  addNodeToMap,
  copyMapSelection,
  pasteMapSelection,
  removeEdgeFromMap,
  removeMapFromWorkspace,
  removeNodesFromMap,
  updateNodeInMap,
} from "./mapOperations";

function mapWithTwoNodes() {
  const parent = mkNode("Parent", "", 0, 0, 0);
  const child = mkNode("Child", "", 10, 20, 1, "rect", {
    attachments: [{ id: "url-1", type: "url", name: "Docs", path: "https://docs.example.com/?q=1#top" }],
    links: [{ label: "Home", url: "https://example.com" }],
  });
  const map = createMap("Test", "Livre");
  return { ...map, nodes: [parent, child], edges: [mkEdge(parent.id, child.id, "dashed")] };
}

describe("map operations", () => {
  it("adds and edits nodes while retaining their existing attachments", () => {
    const map = mapWithTwoNodes();
    const added = mkNode("New", "", 20, 30, 2);
    const withChild = addNodeToMap(map, added, map.nodes[0].id);
    expect(withChild.nodes.map(node => node.id)).toContain(added.id);
    expect(withChild.edges.at(-1)).toMatchObject({ source: map.nodes[0].id, target: added.id });

    const edited = updateNodeInMap(withChild, map.nodes[1].id, { title: "Renamed" });
    expect(edited.nodes[1].title).toBe("Renamed");
    expect(edited.nodes[1].attachments).toEqual(map.nodes[1].attachments);
    expect(edited.nodes[1].links).toEqual(map.nodes[1].links);
  });

  it("rejects adding a child with a missing parent instead of creating a dangling edge", () => {
    const map = mapWithTwoNodes();
    const unchanged = addNodeToMap(map, mkNode("Orphan", "", 0, 0, 0), "missing-parent");
    expect(unchanged).toBe(map);
  });

  it("removes deleted nodes and all incident connections", () => {
    const map = mapWithTwoNodes();
    map.collapsedIds = [map.nodes[0].id, map.nodes[1].id];
    const deleted = removeNodesFromMap(map, new Set([map.nodes[0].id]));
    expect(deleted.nodes.map(node => node.id)).toEqual([map.nodes[1].id]);
    expect(deleted.edges).toEqual([]);
    expect(deleted.collapsedIds).toEqual([map.nodes[1].id]);
  });

  it("deletes an edge without changing either endpoint", () => {
    const map = mapWithTwoNodes();
    const changed = removeEdgeFromMap(map, map.edges[0].id);
    expect(changed.edges).toEqual([]);
    expect(changed.nodes).toEqual(map.nodes);
  });

  it("pastes the copied selection and its internal edges using fresh endpoint IDs", () => {
    const source = mapWithTwoNodes();
    const clipboard = copyMapSelection(source, new Set(source.nodes.map(node => node.id)))!;
    const destination = createMap("Destination", "Livre");
    const result = pasteMapSelection(destination, clipboard, 50, 60);
    const pastedIds = new Set(result.nodeIds);
    const pastedNodes = result.map.nodes.filter(node => pastedIds.has(node.id));

    expect(result.map.nodes).toHaveLength(destination.nodes.length + 2);
    expect(pastedNodes).toHaveLength(2);
    expect(pastedNodes[1].attachments).toEqual(source.nodes[1].attachments);
    expect(pastedNodes[1].links).toEqual(source.nodes[1].links);
    expect(pastedNodes[0].x).toBe(source.nodes[0].x + 50);
    expect(pastedNodes[0].y).toBe(source.nodes[0].y + 60);
    expect(result.map.edges).toHaveLength(destination.edges.length + 1);
    expect(pastedIds.has(result.map.edges.at(-1)!.source)).toBe(true);
    expect(pastedIds.has(result.map.edges.at(-1)!.target)).toBe(true);
    expect(result.map.edges.at(-1)!.style).toBe("dashed");
    expect(pastedNodes.map(node => node.id)).not.toContain(source.nodes[0].id);
  });

  it("preserves the active map when deleting a different map and creates a fallback for the last map", () => {
    const first = createMap("First", "Livre");
    const active = createMap("Active", "Livre");
    const last = createMap("Last", "Livre");
    const workspace = { active: active.id, maps: [first, active, last] };

    expect(removeMapFromWorkspace(workspace, first.id).active).toBe(active.id);
    const remaining = removeMapFromWorkspace(workspace, active.id);
    expect(remaining.active).toBe(last.id);
    expect(remaining.maps.map(map => map.id)).toEqual([first.id, last.id]);

    const fallback = createMap("Fallback", "Livre");
    expect(removeMapFromWorkspace({ active: first.id, maps: [first] }, first.id, () => fallback)).toEqual({
      active: fallback.id,
      maps: [fallback],
    });
  });
});
