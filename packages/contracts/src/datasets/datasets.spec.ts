import { describe, expect, it } from "vitest";
import { datasetNameParamsSchema, datasetSchema } from "./datasets.js";

const dataset = {
  name: "urban_heat_simulation",
  title: "Urban heat simulation",
  description: "Air temperature over a city volume mesh",
  dataCategory: "simulation",
  resultKind: "field",
  argsSchema: { type: "object", properties: { bounds: { type: "array" } } },
  timeoutHint: null,
};

describe("datasetSchema", () => {
  it("strips properties the API does not declare", () => {
    expect(datasetSchema.parse({ ...dataset, pythonReturnType: "dtcc_core.model.VolumeMesh" })).toEqual(dataset);
  });
});

describe("datasetNameParamsSchema", () => {
  it("accepts a Dataset name", () => {
    expect(datasetNameParamsSchema.parse({ name: "urban_heat_simulation" })).toEqual({ name: "urban_heat_simulation" });
  });

  // The name becomes part of the engine's URL.
  it("rejects anything but lowercase letters, digits and underscores", () => {
    expect(datasetNameParamsSchema.safeParse({ name: "../x" }).success).toBe(false);
    expect(datasetNameParamsSchema.safeParse({ name: "Smoke" }).success).toBe(false);
    expect(datasetNameParamsSchema.safeParse({ name: "smoke?x=1" }).success).toBe(false);
  });

  it("rejects an empty or overlong name", () => {
    expect(datasetNameParamsSchema.safeParse({ name: "" }).success).toBe(false);
    expect(datasetNameParamsSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });
});
