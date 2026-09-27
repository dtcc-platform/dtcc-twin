import type { Job, JobArtifact, JobResult } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { arrangeLayers, drawableArtifact, jobsOnBounds, reorder } from "./layers";

const chalmers = [319370, 6397790, 319996, 6398431];

function job(id: string, parameters: Record<string, unknown>): Job {
  return {
    id,
    dataset: "building_footprints",
    parameters,
    state: "completed",
    progress: null,
    error: null,
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    completedAt: null,
  };
}

describe("jobsOnBounds", () => {
  it("keeps the jobs run on exactly these bounds, in their order", () => {
    const jobs = [
      job("a", { bounds: chalmers }),
      job("b", { bounds: [319371, 6397790, 319996, 6398431] }),
      job("c", { bounds: chalmers, source: "OSM" }),
    ];

    expect(jobsOnBounds(jobs, chalmers).map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("skips jobs whose bounds are missing or not a list of numbers", () => {
    const jobs = [job("a", {}), job("b", { bounds: "319370,6397790,319996,6398431" }), job("c", { bounds: [1, 2] })];

    expect(jobsOnBounds(jobs, chalmers)).toEqual([]);
  });
});

describe("arrangeLayers", () => {
  const jobs = ["d", "c", "b", "a"].map((id) => job(id, { bounds: chalmers }));

  it("keeps the jobs' own order, newest first, until any is moved", () => {
    expect(arrangeLayers(jobs, [], []).map((entry) => entry.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("follows the saved order, with jobs it doesn't list on top", () => {
    expect(arrangeLayers(jobs, ["a", "c", "b"], []).map((entry) => entry.id)).toEqual(["d", "a", "c", "b"]);
  });

  it("leaves out removed layers", () => {
    expect(arrangeLayers(jobs, [], ["c", "a"]).map((entry) => entry.id)).toEqual(["d", "b"]);
  });
});

describe("reorder", () => {
  it("moves a layer up or down one place among the area's layers", () => {
    expect(reorder([], ["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(reorder([], ["a", "b", "c"], "a", "down")).toEqual(["b", "a", "c"]);
  });

  it("leaves the order alone at either end", () => {
    expect(reorder([], ["a", "b"], "a", "up")).toEqual(["a", "b"]);
    expect(reorder([], ["a", "b"], "b", "down")).toEqual(["a", "b"]);
  });

  it("keeps other areas' layers in the saved order, after this area's", () => {
    expect(reorder(["x", "b", "y", "a"], ["b", "a"], "a", "up")).toEqual(["a", "b", "x", "y"]);
  });
});

describe("drawableArtifact", () => {
  const model: JobArtifact = artifact({
    file: "model.dtcc",
    format: "dtcc",
    mediaType: "application/vnd.dtcc.model+protobuf",
  });

  function artifact(changes: Partial<JobArtifact>): JobArtifact {
    return {
      file: "building_footprints.geojson",
      role: "primary",
      format: "geojson",
      mediaType: "application/geo+json",
      dataKind: "vector",
      crs: "EPSG:3006",
      size: 303156,
      ...changes,
    };
  }

  function result(artifacts: JobArtifact[]): JobResult {
    return {
      schemaVersion: "dtcc-dataset-manifest-v2",
      title: "Building Footprints",
      description: "",
      headline: null,
      summary: null,
      license: null,
      providers: [],
      processingSteps: [],
      generatedBy: null,
      warnings: [],
      limitations: [],
      parameters: {},
      artifacts,
    };
  }

  it("picks the GeoJSON artifact in a coordinate system the map can take", () => {
    const geojson = artifact({});

    expect(drawableArtifact(result([model, geojson]))).toBe(geojson);
    expect(drawableArtifact(result([artifact({ crs: "EPSG:4326" })]))?.crs).toBe("EPSG:4326");
    expect(drawableArtifact(result([artifact({ crs: null })]))?.crs).toBeNull();
  });

  it("finds nothing to draw in a canonical model or in an unknown coordinate system", () => {
    expect(drawableArtifact(result([model]))).toBeNull();
    expect(drawableArtifact(result([artifact({ crs: "EPSG:3857" })]))).toBeNull();
  });
});
