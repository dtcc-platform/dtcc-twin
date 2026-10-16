import { describe, expect, it } from "vitest";
import { sweref } from "@/lib/sweref";
import {
  areaBounds,
  areaSizeProblem,
  areaSizeProblemText,
  areaSquareMetres,
  formatSquareMetres,
  type Area,
} from "./area.ts";

// A box around Chalmers, Gothenburg, and the EPSG:3006 bounds DTCC Core computes between its south-west and north-east corners.
const chalmers: Area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
const coreBounds = [319370, 6397790, 319996, 6398431];

describe("areaBounds", () => {
  it("contains every corner of the box, in whole metres", () => {
    const [minX, minY, maxX, maxY] = areaBounds(chalmers);
    const corners = [
      [chalmers.west, chalmers.south],
      [chalmers.east, chalmers.south],
      [chalmers.east, chalmers.north],
      [chalmers.west, chalmers.north],
    ];

    expect([minX, minY, maxX, maxY].every(Number.isInteger)).toBe(true);
    for (const corner of corners) {
      const [x = Number.NaN, y = Number.NaN] = sweref.forward(corner);
      expect(x).toBeGreaterThanOrEqual(minX);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(y).toBeGreaterThanOrEqual(minY);
      expect(y).toBeLessThanOrEqual(maxY);
    }
  });

  it("reaches past DTCC Core's bounds only where the grid's turn pushes a corner out", () => {
    const [minX, minY, maxX, maxY] = areaBounds(chalmers);

    // West of the central meridian, the box's south-east corner lies south of its south-west one,
    // and its north-west corner north of its north-east one; the other two sides are Core's.
    expect(Math.abs(minX - (coreBounds[0] ?? Number.NaN))).toBeLessThanOrEqual(1);
    expect(Math.abs(maxX - (coreBounds[2] ?? Number.NaN))).toBeLessThanOrEqual(1);
    expect(minY).toBe(6397763);
    expect(maxY).toBe(6398458);
  });
});

describe("areaSquareMetres", () => {
  it("measures the bounds that contain the box", () => {
    // 626 m by 695 m
    expect(areaSquareMetres(chalmers)).toBe(435_070);
  });
});

describe("formatSquareMetres", () => {
  it("shows small areas in whole square metres", () => {
    expect(formatSquareMetres(24.6)).toBe("25 m²");
    expect(formatSquareMetres(8_512.3)).toBe("8,512 m²");
  });

  it("shows areas from a hectare up in square kilometres", () => {
    expect(formatSquareMetres(10_000)).toBe("0.01 km²");
    expect(formatSquareMetres(401_266)).toBe("0.40 km²");
    expect(formatSquareMetres(25_000_000)).toBe("25.00 km²");
  });
});

describe("areaSizeProblem", () => {
  it("accepts sizes within the limits, including the limits themselves", () => {
    expect(areaSizeProblem(25)).toBeUndefined();
    expect(areaSizeProblem(401_266)).toBeUndefined();
    expect(areaSizeProblem(25_000_000)).toBeUndefined();
  });

  it("names the limit an area breaks", () => {
    expect(areaSizeProblem(24.9)).toBe("too-small");
    expect(areaSizeProblem(25_000_001)).toBe("too-large");
  });

  it("explains each problem with its limit", () => {
    expect(areaSizeProblemText["too-small"]).toBe("Under the 25 m² minimum");
    expect(areaSizeProblemText["too-large"]).toBe("Over the 25 km² limit");
  });
});
