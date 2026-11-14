import type { Dataset } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { formatChoices, jobFormat, type FormatChoice } from "./dataset-formats.ts";

// smoke's products and formats, abridged from the catalog.
const smoke: Pick<Dataset, "argsSchema" | "artifactFormats"> = {
  argsSchema: {
    properties: {
      bounds: { type: "array" },
      product: { default: "field", enum: ["field", "slice"], title: "Product", type: "string" },
      slice_axis: { default: "z", enum: ["x", "y", "z"], title: "Slice Axis", type: "string" },
    },
  },
  artifactFormats: [
    { product: "field", formats: [] },
    {
      product: "slice",
      formats: [
        { format: "geojson", requires: {} },
        { format: "png", requires: { slice_axis: "z" } },
        { format: "tif", requires: { slice_axis: "z" } },
      ],
    },
  ],
};

describe("formatChoices", () => {
  it("offers nothing for a product without formats, such as the default one", () => {
    expect(formatChoices(smoke, {})).toEqual([]);
  });

  it("offers the chosen product's formats, those the map draws first, PNG before GeoJSON", () => {
    expect(formatChoices(smoke, { product: "slice" })).toEqual([
      { format: "png", unavailable: null },
      { format: "geojson", unavailable: null },
      { format: "tif", unavailable: null },
    ]);
  });

  it("says why a format the chosen parameters rule out isn't available, naming the parameter by its title", () => {
    expect(formatChoices(smoke, { product: "slice", slice_axis: "x" })).toEqual([
      { format: "png", unavailable: "Needs Slice Axis = z" },
      { format: "geojson", unavailable: null },
      { format: "tif", unavailable: "Needs Slice Axis = z" },
    ]);
  });

  // The job's parameters leave out values at their default, so a missing one is its default.
  it("reads a parameter left out of the job as its default", () => {
    const argsSchema = { properties: { product: { default: "slice" }, slice_axis: { default: "z" } } };

    const choices = formatChoices({ ...smoke, argsSchema }, {});

    expect(choices.map((choice) => choice.unavailable)).toEqual([null, null, null]);
  });

  it("finds the formats of a Dataset with one product, listed under a null product", () => {
    const roads: Pick<Dataset, "argsSchema" | "artifactFormats"> = {
      argsSchema: { properties: { bounds: { type: "array" } } },
      artifactFormats: [{ product: null, formats: [{ format: "geojson", requires: {} }] }],
    };

    expect(formatChoices(roads, {})).toEqual([{ format: "geojson", unavailable: null }]);
  });

  it("offers nothing for a Dataset the engine lists no formats for", () => {
    expect(formatChoices({ ...smoke, artifactFormats: [] }, { product: "slice" })).toEqual([]);
  });
});

describe("jobFormat", () => {
  const choices: FormatChoice[] = [
    { format: "png", unavailable: "Needs Slice Axis = z" },
    { format: "geojson", unavailable: null },
    { format: "tif", unavailable: null },
  ];

  it("keeps the chosen format while it's available", () => {
    expect(jobFormat(choices, "tif")).toBe("tif");
  });

  it("falls back to the first available format when the chosen one isn't, or none was chosen", () => {
    expect(jobFormat(choices, "png")).toBe("geojson");
    expect(jobFormat(choices, null)).toBe("geojson");
  });

  it("is null when no format is available", () => {
    expect(jobFormat([], null)).toBeNull();
    expect(jobFormat([{ format: "png", unavailable: "Needs Slice Axis = z" }], "png")).toBeNull();
  });
});
