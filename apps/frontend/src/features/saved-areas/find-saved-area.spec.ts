import type { SavedArea } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { findSavedArea } from "./find-saved-area.ts";

const chalmers = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };

function saved(name: string, area: SavedArea["area"]): SavedArea {
  return {
    id: `0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a${name.length.toString().padStart(2, "0")}`,
    name,
    area,
    createdAt: "2026-10-18T10:00:00.000Z",
    updatedAt: "2026-10-18T10:00:00.000Z",
  };
}

const savedAreas = [saved("Lindholmen", { ...chalmers, west: 11.9 }), saved("Chalmers", chalmers)];

describe("findSavedArea", () => {
  it("finds the saved area with exactly the same box", () => {
    expect(findSavedArea({ ...chalmers }, savedAreas)?.name).toBe("Chalmers");
  });

  it("finds a drawn area again after the bounds inspector has set it, rounded to its six decimals", () => {
    const drawn = { west: 11.973479774, south: 57.681873693, east: 11.993160089, north: 57.687844855 };
    const setByInspector = { west: 11.97348, south: 57.681874, east: 11.99316, north: 57.687845 };

    expect(findSavedArea(setByInspector, [saved("cham", drawn)])?.name).toBe("cham");
  });

  it("finds none for a box that differs on any side, at the inspector's precision", () => {
    expect(findSavedArea({ ...chalmers, north: 57.692001 }, savedAreas)).toBeUndefined();
  });

  it("finds none without an area", () => {
    expect(findSavedArea(null, savedAreas)).toBeUndefined();
  });
});
