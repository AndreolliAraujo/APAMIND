import { describe, expect, it } from "vitest";
import { createMap } from "./core/templates";
import { createMapHistory, recordMapHistory, redoMapHistory, undoMapHistory } from "./mapHistory";

describe("map history", () => {
  it("stores a snapshot and clears redo history after a new edit", () => {
    const map = createMap("Initial", "Livre");
    const history = { past: [map], future: [map] };

    const next = recordMapHistory(history, map);

    expect(next.past).toHaveLength(2);
    expect(next.past[1]).not.toBe(map);
    expect(next.future).toEqual([]);
  });

  it("undoes and redoes snapshots without mutating either stack", () => {
    const previous = createMap("Previous", "Livre");
    const current = createMap("Current", "Livre");
    const initial = { past: [previous], future: [] };

    const undone = undoMapHistory(initial, current);
    expect(undone.map).toBe(previous);
    expect(undone.history.past).toEqual([]);
    expect(undone.history.future[0]).not.toBe(current);
    expect(initial.past).toEqual([previous]);

    const redone = redoMapHistory(undone.history, previous);
    expect(redone.map).toEqual(current);
    expect(redone.map).not.toBe(current);
    expect(redone.history.past[0]).not.toBe(previous);
    expect(redone.history.future).toEqual([]);
  });

  it("caps undo history at forty entries", () => {
    const maps = Array.from({ length: 42 }, (_, index) => createMap(`Map ${index}`, "Livre"));
    const history = maps.reduce((state, map) => recordMapHistory(state, map), createMapHistory());

    expect(history.past).toHaveLength(40);
    expect(history.past[0].title).toBe("Map 2");
  });

  it("returns no snapshot when the requested stack is empty", () => {
    const map = createMap("Current", "Livre");
    const history = createMapHistory();

    expect(undoMapHistory(history, map)).toEqual({ history, map: null });
    expect(redoMapHistory(history, map)).toEqual({ history, map: null });
  });
});
