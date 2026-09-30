import { describe, expect, it } from "vitest";
import { areaSizeProblem, areaSquareMetres, formatSquareMetres, swerefBounds, type Area } from "./area.ts";

// A box around Chalmers, Gothenburg, and the EPSG:3006 bounds DTCC Core computed for it.
const chalmers: Area = { west: 11.97, south: 57.686, east: 11.98, north: 57.692 };
const chalmersBounds = [319370, 6397790, 319996, 6398431];

describe("swerefBounds", () => {
  it("matches the bounds DTCC Core computes, to the metre", () => {
    const bounds = swerefBounds(chalmers);

    bounds.forEach((value, index) => {
      expect(Math.abs(value - (chalmersBounds[index] ?? Number.NaN))).toBeLessThanOrEqual(1);
    });
  });

  it("rounds to whole metres", () => {
    expect(swerefBounds(chalmers).every(Number.isInteger)).toBe(true);
  });
});

describe("areaSquareMetres", () => {
  it("measures the box on the EPSG:3006 grid", () => {
    // 626 m by 641 m
    expect(areaSquareMetres(chalmers)).toBeCloseTo(401_266, -3);
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
    expect(areaSizeProblem(24.9)).toBe("Under the 25 m² minimum");
    expect(areaSizeProblem(25_000_001)).toBe("Over the 25 km² limit");
  });
});
