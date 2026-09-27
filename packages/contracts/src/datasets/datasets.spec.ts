import { describe, expect, it } from "vitest";
import { datasetNameParamsSchema, datasetSchema } from "./datasets.js";

const dataset = {
  name: "building_footprints",
  title: "Building Footprints",
  description: "Building footprint polygons",
  dataCategory: "raw",
  resultKind: "building_footprints",
  argsSchema: {
    type: "object",
    properties: { source: { enum: ["OSM", "LM"], default: "LM" } },
    additionalProperties: false,
  },
  timeoutHint: null,
  available: true,
};

describe("datasetSchema", () => {
  it("strips properties the API does not declare", () => {
    expect(datasetSchema.parse({ ...dataset, pythonReturnType: "dtcc_core.model.FootprintCollection" })).toEqual(
      dataset,
    );
  });

  it("passes the parameter schema through whole, since Atlas builds its form from it", () => {
    expect(datasetSchema.parse(dataset).argsSchema).toEqual(dataset.argsSchema);
  });
});

describe("datasetNameParamsSchema", () => {
  it("accepts a DTCC Dataset name", () => {
    expect(datasetNameParamsSchema.parse({ name: "urban_wind_simulation" })).toEqual({ name: "urban_wind_simulation" });
  });

  it("rejects anything else, so a name can never act as a path", () => {
    expect(datasetNameParamsSchema.safeParse({ name: "../deso" }).success).toBe(false);
    expect(datasetNameParamsSchema.safeParse({ name: "Building Footprints" }).success).toBe(false);
    expect(datasetNameParamsSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });
});
