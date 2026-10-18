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

  it("finds none for a box that differs on any side", () => {
    expect(findSavedArea({ ...chalmers, north: 57.6921 }, savedAreas)).toBeUndefined();
  });

  it("finds none without an area", () => {
    expect(findSavedArea(null, savedAreas)).toBeUndefined();
  });
});
