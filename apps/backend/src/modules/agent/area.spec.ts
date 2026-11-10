import { describe, expect, it } from "vitest";
import { areaBounds, areaSquareMetres } from "./area.js";

describe("agent area", () => {
  it("covers the drawn Chalmers box in whole EPSG:3006 metres", () => {
    const area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
    expect(areaBounds(area)).toEqual([319370, 6397763, 319996, 6398458]);
    expect(areaSquareMetres(area)).toBe(435070);
  });
  it("matches the small fixture bounds", () => {
    expect(areaBounds({ west: 11.972, south: 57.688, east: 11.975, north: 57.6895 })).toEqual([
      319499, 6397999, 319686, 6398175,
    ]);
  });
});
