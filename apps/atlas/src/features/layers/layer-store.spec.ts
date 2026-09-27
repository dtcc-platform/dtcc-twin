import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createLayerStore, layerSettings } from "./layer-store";

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

describe("createLayerStore", () => {
  it("shows a layer it knows nothing about, fully opaque", () => {
    const state = createLayerStore(memoryStorage()).getState();

    expect(layerSettings(state, "a")).toEqual({ visible: true, opacity: 1 });
  });

  it("hides and shows a layer, and sets its opacity, without touching others", () => {
    const store = createLayerStore(memoryStorage());
    const { toggleVisible, setOpacity } = store.getState().actions;

    toggleVisible("a");
    setOpacity("a", 0.5);
    expect(layerSettings(store.getState(), "a")).toEqual({ visible: false, opacity: 0.5 });
    expect(layerSettings(store.getState(), "b")).toEqual({ visible: true, opacity: 1 });

    toggleVisible("a");
    expect(layerSettings(store.getState(), "a").visible).toBe(true);
  });

  it("moves a layer among its area's layers", () => {
    const store = createLayerStore(memoryStorage());

    store.getState().actions.move(["a", "b", "c"], "c", "up");

    expect(store.getState().order).toEqual(["a", "c", "b"]);
  });

  it("removes a layer", () => {
    const store = createLayerStore(memoryStorage());

    store.getState().actions.remove("a");

    expect(store.getState().removed).toEqual(["a"]);
  });

  it("keeps settings, order and removals in storage", () => {
    const storage = memoryStorage();
    const store = createLayerStore(storage);
    const { toggleVisible, move, remove } = store.getState().actions;
    toggleVisible("a");
    move(["a", "b"], "b", "up");
    remove("c");

    const restored = createLayerStore(storage).getState();

    expect(layerSettings(restored, "a").visible).toBe(false);
    expect(restored.order).toEqual(["b", "a"]);
    expect(restored.removed).toEqual(["c"]);
  });
});
