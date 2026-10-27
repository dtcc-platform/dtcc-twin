import { describe, expect, it } from "vitest";
import type { Area } from "./area.ts";
import { createAreaStore } from "./area-store.ts";

const first: Area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
const second: Area = { west: 11.95, south: 57.68, east: 11.96, north: 57.69 };

describe("createAreaStore", () => {
  it("starts with no area and not drawing", () => {
    const { area, drawing, preview } = createAreaStore().getState();

    expect(area).toBeNull();
    expect(drawing).toBeNull();
    expect(preview).toBeNull();
  });

  it("discards the current area when a new drawing starts", () => {
    const store = createAreaStore();
    const { setArea, startDrawing } = store.getState().actions;

    setArea(first);
    startDrawing();

    expect(store.getState().area).toBeNull();
    expect(store.getState().drawing).toBe("first-corner");
  });

  it("waits for the opposite corner once the first is placed", () => {
    const store = createAreaStore();
    const { startDrawing, placeFirstCorner } = store.getState().actions;

    startDrawing();
    placeFirstCorner();

    expect(store.getState().drawing).toBe("opposite-corner");
  });

  it("only places a corner while drawing", () => {
    const store = createAreaStore();

    store.getState().actions.placeFirstCorner();

    expect(store.getState().drawing).toBeNull();
  });

  it("ends the drawing with the drawn box as the area", () => {
    const store = createAreaStore();
    const { startDrawing, placeFirstCorner, setPreview, setArea } = store.getState().actions;

    startDrawing();
    placeFirstCorner();
    setPreview(first);
    setArea(first);

    expect(store.getState().area).toEqual(first);
    expect(store.getState().drawing).toBeNull();
    expect(store.getState().preview).toBeNull();
  });

  it("leaves no area when a drawing is cancelled", () => {
    const store = createAreaStore();
    const { setArea, startDrawing, placeFirstCorner, setPreview, cancelDrawing } = store.getState().actions;

    setArea(first);
    startDrawing();
    placeFirstCorner();
    setPreview(second);
    cancelDrawing();

    expect(store.getState().area).toBeNull();
    expect(store.getState().drawing).toBeNull();
    expect(store.getState().preview).toBeNull();
  });

  it("replaces the area when it is moved or resized", () => {
    const store = createAreaStore();
    const { setArea, setPreview } = store.getState().actions;

    setArea(first);
    setPreview(second);

    expect(store.getState().preview).toEqual(second);
    expect(store.getState().area).toEqual(first);

    setArea(second);

    expect(store.getState().area).toEqual(second);
    expect(store.getState().preview).toBeNull();
  });

  it("clears the area, and any drawing in progress", () => {
    const store = createAreaStore();
    const { setArea, clearArea, startDrawing } = store.getState().actions;

    setArea(first);
    clearArea();

    expect(store.getState().area).toBeNull();

    startDrawing();
    clearArea();

    expect(store.getState().drawing).toBeNull();
  });
});
