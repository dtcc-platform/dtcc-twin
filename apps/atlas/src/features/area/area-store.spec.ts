import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { Area } from "./area";
import { createAreaStore, selectedArea, type AreaStore } from "./area-store";

const chalmers: Area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
const lindholmen: Area = { west: 11.93, south: 57.705, east: 11.94, north: 57.71 };

// Stands in for localStorage, so each test starts empty and can look at what was written.
function memoryStorage(): StateStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function draw(store: AreaStore, area: Area): string {
  const { startDrawing, addDrawnArea } = store.getState().actions;
  startDrawing();
  addDrawnArea(area);
  return store.getState().selectedId ?? "";
}

describe("createAreaStore", () => {
  it("starts with no areas, nothing selected and no drawing", () => {
    const state = createAreaStore(memoryStorage()).getState();

    expect(state).toMatchObject({ areas: [], selectedId: null, drawing: false });
    expect(selectedArea(state)).toBeNull();
  });

  it("saves each drawn area under a dated name, newest first, and selects it", () => {
    const store = createAreaStore(memoryStorage());

    draw(store, chalmers);
    const lindholmenId = draw(store, lindholmen);

    const state = store.getState();
    expect(state.areas.map((entry) => entry.area)).toEqual([lindholmen, chalmers]);
    expect(state.areas.every((entry) => entry.name.startsWith("Area "))).toBe(true);
    expect(state).toMatchObject({ selectedId: lindholmenId, drawing: false });
    expect(selectedArea(state)?.area).toEqual(lindholmen);
  });

  it("starting to draw unselects the area; cancelling leaves nothing selected", () => {
    const store = createAreaStore(memoryStorage());
    draw(store, chalmers);
    const { startDrawing, cancelDrawing } = store.getState().actions;

    startDrawing();
    expect(store.getState()).toMatchObject({ drawing: true, selectedId: null });

    cancelDrawing();
    expect(store.getState()).toMatchObject({ drawing: false, selectedId: null });
    expect(store.getState().areas).toHaveLength(1);
  });

  it("selects and unselects a saved area", () => {
    const store = createAreaStore(memoryStorage());
    const id = draw(store, chalmers);
    const { select, unselect } = store.getState().actions;

    unselect();
    expect(store.getState().selectedId).toBeNull();

    select(id);
    expect(selectedArea(store.getState())?.area).toEqual(chalmers);
  });

  it("changes the selected area's bounds and nothing else's", () => {
    const store = createAreaStore(memoryStorage());
    const chalmersId = draw(store, chalmers);
    draw(store, lindholmen);
    store.getState().actions.select(chalmersId);
    const moved = { ...chalmers, east: 11.99 };

    store.getState().actions.updateSelectedArea(moved);

    expect(store.getState().areas.map((entry) => entry.area)).toEqual([lindholmen, moved]);
  });

  it("changes no bounds with nothing selected", () => {
    const store = createAreaStore(memoryStorage());
    draw(store, chalmers);
    store.getState().actions.unselect();

    store.getState().actions.updateSelectedArea(lindholmen);

    expect(store.getState().areas[0]?.area).toEqual(chalmers);
  });

  it("renames an area with a trimmed name, and ignores a blank one", () => {
    const store = createAreaStore(memoryStorage());
    const id = draw(store, chalmers);
    const { rename } = store.getState().actions;

    rename(id, "  Chalmers campus  ");
    expect(store.getState().areas[0]?.name).toBe("Chalmers campus");

    rename(id, "   ");
    expect(store.getState().areas[0]?.name).toBe("Chalmers campus");
  });

  it("deletes an area, unselecting it if it was selected", () => {
    const store = createAreaStore(memoryStorage());
    const chalmersId = draw(store, chalmers);
    const lindholmenId = draw(store, lindholmen);
    const { deleteArea } = store.getState().actions;

    deleteArea(chalmersId);
    expect(store.getState()).toMatchObject({ selectedId: lindholmenId });
    expect(store.getState().areas.map((entry) => entry.id)).toEqual([lindholmenId]);

    deleteArea(lindholmenId);
    expect(store.getState()).toMatchObject({ areas: [], selectedId: null });
  });

  it("keeps the areas in storage, with their changes, but not the selection", () => {
    const storage = memoryStorage();
    const store = createAreaStore(storage);
    const id = draw(store, chalmers);
    store.getState().actions.rename(id, "Chalmers campus");

    const restored = createAreaStore(storage).getState();

    expect(restored.areas).toEqual(store.getState().areas);
    expect(restored.selectedId).toBeNull();
  });
});
