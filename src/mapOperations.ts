import type { MEdge, MMap, MNode, Workspace } from "./core/model";
import { mkEdge, uid } from "./core/model";
import { createMap } from "./core/templates";

export interface MapClipboard {
  nodes: MNode[];
  edges: MEdge[];
}

export function addNodeToMap(map: MMap, node: MNode, parentId?: string): MMap {
  if (parentId && !map.nodes.some(existing => existing.id === parentId)) return map;
  return {
    ...map,
    nodes: [...map.nodes, node],
    edges: parentId ? [...map.edges, mkEdge(parentId, node.id)] : map.edges,
  };
}

export function updateNodeInMap(map: MMap, id: string, patch: Partial<MNode>): MMap {
  return { ...map, nodes: map.nodes.map(node => node.id === id ? { ...node, ...patch, id: node.id } : node) };
}

export function removeNodesFromMap(map: MMap, ids: ReadonlySet<string>): MMap {
  if (!ids.size) return map;
  return {
    ...map,
    nodes: map.nodes.filter(node => !ids.has(node.id)),
    edges: map.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)),
    ...(map.collapsedIds ? { collapsedIds: map.collapsedIds.filter(id => !ids.has(id)) } : {}),
  };
}

export function removeEdgeFromMap(map: MMap, edgeId: string): MMap {
  return { ...map, edges: map.edges.filter(edge => edge.id !== edgeId) };
}

export function copyMapSelection(map: MMap, selectedIds: ReadonlySet<string>): MapClipboard | null {
  const nodes = map.nodes.filter(node => selectedIds.has(node.id));
  if (!nodes.length) return null;
  const ids = new Set(nodes.map(node => node.id));
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(map.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))),
  };
}

export function pasteMapSelection(
  map: MMap,
  clipboard: MapClipboard,
  offsetX = 80,
  offsetY = 80,
): { map: MMap; nodeIds: string[] } {
  const idMap = new Map(clipboard.nodes.map(node => [node.id, uid("n")]));
  const nodes = clipboard.nodes.map(node => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    x: node.x + offsetX,
    y: node.y + offsetY,
  }));
  const edges = clipboard.edges.flatMap(edge => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    return source && target ? [mkEdge(source, target, edge.style)] : [];
  });
  return { map: { ...map, nodes: [...map.nodes, ...nodes], edges: [...map.edges, ...edges] }, nodeIds: nodes.map(node => node.id) };
}

export function removeMapFromWorkspace(
  workspace: Workspace,
  mapId: string,
  createFallback: () => MMap = () => createMap("Meu Primeiro Mapa", "Modelo A"),
): Workspace {
  const deletedIndex = workspace.maps.findIndex(map => map.id === mapId);
  if (deletedIndex < 0) return workspace;
  const maps = workspace.maps.filter(map => map.id !== mapId);
  if (!maps.length) {
    const fallback = createFallback();
    return { active: fallback.id, maps: [fallback] };
  }
  if (workspace.active !== mapId && maps.some(map => map.id === workspace.active)) {
    return { ...workspace, maps };
  }
  const nextActive = maps[Math.min(deletedIndex, maps.length - 1)].id;
  return { ...workspace, active: nextActive, maps };
}
