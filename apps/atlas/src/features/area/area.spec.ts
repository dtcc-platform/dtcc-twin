import { describe, expect, it } from "vitest";
import { areaFormSchema, areaSquareMetres, swerefBounds, type Area } from "./area";

// The demo area, and the EPSG:3006 bounds pyproj gave for it when the fake engine's fixtures were recorded.
const demoArea: Area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
const recordedBounds = [319370, 6397790, 319996, 6398431];

describe("swerefBounds", () => {
  it("converts a WGS84 box to the EPSG:3006 bounds Datasets take, within a few metres of pyproj", () => {
    const bounds = swerefBounds(demoArea);

    bounds.forEach((value, index) => {
      expect(Math.abs(value - (recordedBounds[index] ?? Number.NaN))).toBeLessThanOrEqual(5);
    });
  });

  it("answers whole metres, minimum corner first", () => {
    const [minX, minY, maxX, maxY] = swerefBounds(demoArea);

    expect([minX, minY, maxX, maxY].every(Number.isInteger)).toBe(true);
    expect(minX).toBeLessThan(maxX);
    expect(minY).toBeLessThan(maxY);
  });
});

describe("areaSquareMetres", () => {
  it("measures the area of the EPSG:3006 bounds", () => {
    const [minX, minY, maxX, maxY] = recordedBounds as [number, number, number, number];

    expect(areaSquareMetres(demoArea) / ((maxX - minX) * (maxY - minY))).toBeCloseTo(1, 1);
  });
});

describe("areaFormSchema", () => {
  function issuesOf(values: Partial<Record<keyof Area, number>>) {
    const result = areaFormSchema.safeParse({ ...demoArea, ...values });
    return result.success
      ? []
      : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  }

  it("accepts the demo area", () => {
    expect(issuesOf({})).toEqual([]);
  });

  it("puts an inverted box's issue under the field to correct", () => {
    expect(issuesOf({ north: 57.68 })).toEqual([{ path: "north", message: "North must be greater than south" }]);
    expect(issuesOf({ east: 11.96 })).toEqual([{ path: "east", message: "East must be greater than west" }]);
  });

  it("rejects latitudes and longitudes out of range, and empty fields", () => {
    expect(issuesOf({ north: 91 }).map((issue) => issue.path)).toContain("north");
    expect(issuesOf({ west: -181 }).map((issue) => issue.path)).toContain("west");
    expect(issuesOf({ south: Number.NaN }).map((issue) => issue.path)).toContain("south");
  });

  it("rejects an area under 25 m² or over 25 km²", () => {
    expect(issuesOf({ east: 11.97003, north: 57.68602 })).toEqual([
      { path: "", message: "The area must be at least 25 m²" },
    ]);
    expect(issuesOf({ east: 12.1, north: 57.75 })).toEqual([{ path: "", message: "The area must be at most 25 km²" }]);
  });
});
