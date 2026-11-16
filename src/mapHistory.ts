import type { MMap } from "./core/model";

const HISTORY_LIMIT = 40;

export interface MapHistory {
  past: MMap[];
  future: MMap[];
}

export function createMapHistory(): MapHistory {
  return { past: [], future: [] };
}

export function recordMapHistory(history: MapHistory, map: MMap): MapHistory {
  return {
    past: [...history.past.slice(-(HISTORY_LIMIT - 1)), structuredClone(map)],
    future: [],
  };
}

export function undoMapHistory(history: MapHistory, currentMap: MMap): { history: MapHistory; map: MMap | null } {
  if (history.past.length === 0) return { history, map: null };
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, structuredClone(currentMap)],
    },
    map: history.past[history.past.length - 1],
  };
}

export function redoMapHistory(history: MapHistory, currentMap: MMap): { history: MapHistory; map: MMap | null } {
  if (history.future.length === 0) return { history, map: null };
  return {
    history: {
      past: [...history.past, structuredClone(currentMap)],
      future: history.future.slice(0, -1),
    },
    map: history.future[history.future.length - 1],
  };
}
