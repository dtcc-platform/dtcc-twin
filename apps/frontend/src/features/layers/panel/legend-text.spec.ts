import { describe, expect, it } from "vitest";
import { legendTitle, legendValue } from "./legend-text.ts";

describe("legendTitle", () => {
  it("names the field, with its unit", () => {
    expect(legendTitle({ field: "speed", unit: "m/s" })).toBe("Speed (m/s)");
  });

  it("names a field of several words as a sentence", () => {
    expect(legendTitle({ field: "air_temperature", unit: "°C" })).toBe("Air temperature (°C)");
  });

  it("leaves out what Core didn't say", () => {
    expect(legendTitle({ field: "height", unit: null })).toBe("Height");
    expect(legendTitle({ field: null, unit: "m" })).toBe("m");
    expect(legendTitle({ field: null, unit: null })).toBe("");
  });
});

describe("legendValue", () => {
  it("shows three significant digits", () => {
    expect(legendValue(11.21410308244582)).toBe("11.2");
    expect(legendValue(0)).toBe("0");
    expect(legendValue(0.0012345)).toBe("0.00123");
    expect(legendValue(1234.5)).toBe("1,230");
  });
});
