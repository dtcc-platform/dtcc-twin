import { describe, expect, it } from "vitest";
import { createLayersStore, layerColors } from "./layers-store.ts";

describe("createLayersStore", () => {
  it("starts with no results on the map", () => {
    expect(createLayersStore().getState().layers).toEqual([]);
  });

  it("adds a job's result on top, in the next color", () => {
    const store = createLayersStore();
    const { add } = store.getState().actions;

    add({ jobId: "a", title: "Roads" });
    add({ jobId: "b", title: "Trees" });

    expect(store.getState().layers).toEqual([
      { jobId: "a", title: "Roads", color: layerColors[0] },
      { jobId: "b", title: "Trees", color: layerColors[1] },
    ]);
  });

  it("adds a job already on the map only once", () => {
    const store = createLayersStore();
    const { add } = store.getState().actions;

    add({ jobId: "a", title: "Roads" });
    add({ jobId: "a", title: "Roads" });

    expect(store.getState().layers).toHaveLength(1);
  });

  // A layer keeps its color while others come and go, so the map and the list stay matched.
  it("removes a job's result, leaving the others' colors as they were", () => {
    const store = createLayersStore();
    const { add, remove } = store.getState().actions;

    add({ jobId: "a", title: "Roads" });
    add({ jobId: "b", title: "Trees" });
    remove("a");
    add({ jobId: "c", title: "Weather" });

    expect(store.getState().layers).toEqual([
      { jobId: "b", title: "Trees", color: layerColors[1] },
      { jobId: "c", title: "Weather", color: layerColors[2] },
    ]);
  });

  it("starts over from the first color after the last", () => {
    const store = createLayersStore();
    const { add } = store.getState().actions;

    for (const index of layerColors.keys()) add({ jobId: String(index), title: "Roads" });
    add({ jobId: "next", title: "Roads" });

    expect(store.getState().layers.at(-1)?.color).toBe(layerColors[0]);
  });
});
