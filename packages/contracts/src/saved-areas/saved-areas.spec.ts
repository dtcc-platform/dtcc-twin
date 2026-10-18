import { describe, expect, it } from "vitest";
import { createSavedAreaBodySchema, savedAreaSchema } from "./saved-areas.js";

const area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
const savedArea = {
  id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
  name: "Chalmers",
  area,
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
};

describe("savedAreaSchema", () => {
  it("strips properties the API does not declare, such as the owner", () => {
    expect(savedAreaSchema.parse({ ...savedArea, userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b" })).toEqual(savedArea);
  });
});

describe("createSavedAreaBodySchema", () => {
  it("takes a trimmed name and a WGS84 box", () => {
    expect(createSavedAreaBodySchema.parse({ name: "  Chalmers  ", area })).toEqual({ name: "Chalmers", area });
  });

  it("rejects a blank or overlong name", () => {
    expect(createSavedAreaBodySchema.safeParse({ name: "   ", area }).success).toBe(false);
    expect(createSavedAreaBodySchema.safeParse({ name: "x".repeat(101), area }).success).toBe(false);
  });

  it("rejects coordinates off the globe", () => {
    const result = createSavedAreaBodySchema.safeParse({ name: "Off", area: { ...area, west: -181, north: 91 } });

    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["area.west", "area.north"]);
  });

  it("rejects a box whose sides are the wrong way round", () => {
    const result = createSavedAreaBodySchema.safeParse({
      name: "Flipped",
      area: { west: 11.98, south: 57.692, east: 11.97, north: 57.686 },
    });

    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["area.east", "area.north"]);
  });

  it("takes no owner and nothing else", () => {
    expect(createSavedAreaBodySchema.safeParse({ name: "Chalmers", area, userId: savedArea.id }).success).toBe(false);
    expect(createSavedAreaBodySchema.safeParse({ name: "Chalmers", area: { ...area, crs: "EPSG:4326" } }).success).toBe(
      false,
    );
  });
});
