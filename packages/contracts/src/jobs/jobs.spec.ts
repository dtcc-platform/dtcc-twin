import { describe, expect, it } from "vitest";
import { createJobBodySchema, jobArtifactParamsSchema } from "./jobs.js";

const bounds = [319370, 6397790, 319996, 6398431];

describe("createJobBodySchema", () => {
  it("keeps Dataset-specific parameters alongside the bounds", () => {
    const body = { dataset: "building_footprints", parameters: { bounds, source: "OSM" } };

    expect(createJobBodySchema.parse(body)).toEqual(body);
  });

  it("accepts 3D bounds", () => {
    const body = { dataset: "city_volume_mesh", parameters: { bounds: [0, 0, 0, 10, 10, 10] } };

    expect(createJobBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects bounds of the wrong length or with a min not below its max", () => {
    for (const invalid of [
      [0, 0, 10],
      [0, 0, 10, 10, 10],
      [10, 0, 0, 10],
      [0, 0, 5, 10, 10, 5],
    ]) {
      expect(createJobBodySchema.safeParse({ dataset: "deso", parameters: { bounds: invalid } }).success).toBe(false);
    }
  });

  it("requires bounds", () => {
    expect(createJobBodySchema.safeParse({ dataset: "deso", parameters: {} }).success).toBe(false);
  });

  it("rejects unknown keys next to the Dataset and its parameters", () => {
    expect(createJobBodySchema.safeParse({ dataset: "deso", parameters: { bounds }, target: "gpu" }).success).toBe(
      false,
    );
  });
});

describe("jobArtifactParamsSchema", () => {
  it("takes a bare file name, never a path", () => {
    const id = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";

    expect(jobArtifactParamsSchema.safeParse({ id, file: "building_footprints.geojson" }).success).toBe(true);
    expect(jobArtifactParamsSchema.safeParse({ id, file: "../manifest.json" }).success).toBe(false);
  });
});
