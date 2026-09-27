import { describe, expect, it } from "vitest";
import { datasetFormFields, datasetFormSchema, defaultFormValues, jobParameters } from "./dataset-form";

// Shaped like the argument schemas Core generates with Pydantic; see apps/backend/fixtures/engine/descriptors.json.
const argsSchema = {
  type: "object",
  required: ["bounds"],
  properties: {
    bounds: { type: "array", items: { type: "number" }, title: "Bounds" },
    strict_live: { type: "boolean", default: false, title: "Strict Live" },
    format: { anyOf: [{ enum: ["geojson", "gpkg"], type: "string" }, { type: "null" }], default: null },
    crs: { anyOf: [{ type: "string" }, { type: "null" }], default: null },
    source: { type: "string", enum: ["OSM", "LM"], default: "LM", title: "Source", description: "Where from" },
    year: { type: "integer", enum: [2018, 2025], default: 2025, title: "Year" },
    calculate_heights: { type: "boolean", default: false, title: "Calculate Heights" },
    smallest_building_size: { type: "number", default: 0, minimum: 0, title: "Smallest Building Size" },
    divisions: { type: "integer", default: 4, minimum: 1, maximum: 10, title: "Divisions" },
    alpha: { type: "number", default: 0.5, exclusiveMinimum: 0, title: "Alpha" },
    phenomenon: { type: "string", default: "NO2", title: "Phenomenon" },
    statistics_year: { anyOf: [{ type: "integer" }, { type: "null" }], default: null, title: "Statistics Year" },
    tree_type: {
      anyOf: [{ enum: ["urban", "dense"], type: "string" }, { type: "null" }],
      default: null,
      title: "Tree Type",
    },
    statistics: {
      anyOf: [{ type: "array", items: { enum: ["population", "cars"], type: "string" } }, { type: "null" }],
      default: null,
      title: "Statistics",
    },
    pipeline: { type: "string", const: "fast", default: "fast", title: "Pipeline" },
    grid: { type: "array", items: { type: "array" }, title: "Grid" },
  },
};

const bounds = [319370, 6397790, 319996, 6398431];

describe("datasetFormFields", () => {
  const { fields, omitted } = datasetFormFields(argsSchema);
  const byName = new Map(fields.map((field) => [field.name, field]));

  it("leaves out what the app decides: bounds from the area, the package's format and CRS, and strict_live", () => {
    for (const name of ["bounds", "format", "crs", "strict_live"]) expect(byName.has(name)).toBe(false);
  });

  it("keeps the schema's order, title and description", () => {
    expect(fields.map((field) => field.name).slice(0, 3)).toEqual(["source", "year", "calculate_heights"]);
    expect(byName.get("source")).toMatchObject({ label: "Source", description: "Where from" });
  });

  it("turns each kind of property into the matching field", () => {
    expect(byName.get("source")).toMatchObject({
      kind: "choice",
      options: ["OSM", "LM"],
      optional: false,
      default: "LM",
    });
    expect(byName.get("year")).toMatchObject({ kind: "choice", options: [2018, 2025], default: 2025 });
    expect(byName.get("calculate_heights")).toMatchObject({ kind: "boolean", default: false });
    expect(byName.get("smallest_building_size")).toMatchObject({ kind: "number", minimum: 0 });
    expect(byName.get("divisions")).toMatchObject({ kind: "integer", minimum: 1, maximum: 10 });
    expect(byName.get("alpha")).toMatchObject({ kind: "number", exclusiveMinimum: 0 });
    expect(byName.get("phenomenon")).toMatchObject({ kind: "text", default: "NO2" });
  });

  it("makes a property that may be null an optional field", () => {
    expect(byName.get("statistics_year")).toMatchObject({ kind: "integer", optional: true, default: null });
    expect(byName.get("tree_type")).toMatchObject({ kind: "choice", options: ["urban", "dense"], optional: true });
    expect(byName.get("statistics")).toMatchObject({
      kind: "choices",
      options: ["population", "cars"],
      optional: true,
    });
  });

  it("leaves constants and shapes it can't edit at their defaults, and names them", () => {
    expect(byName.has("pipeline")).toBe(false);
    expect(omitted).toEqual(["pipeline", "grid"]);
  });
});

describe("datasetFormSchema", () => {
  const { fields } = datasetFormFields(argsSchema);
  const schema = datasetFormSchema(fields);
  const defaults = defaultFormValues(fields);

  function issuePaths(changes: Record<string, unknown>) {
    const result = schema.safeParse({ ...defaults, ...changes });
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  }

  it("accepts the defaults", () => {
    expect(issuePaths({})).toEqual([]);
  });

  it("applies the schema's bounds, integers and exclusive minimums", () => {
    expect(issuePaths({ smallest_building_size: -1 })).toEqual(["smallest_building_size"]);
    expect(issuePaths({ divisions: 11 })).toEqual(["divisions"]);
    expect(issuePaths({ divisions: 2.5 })).toEqual(["divisions"]);
    expect(issuePaths({ alpha: 0 })).toEqual(["alpha"]);
  });

  it("requires a number unless the field is optional", () => {
    expect(issuePaths({ smallest_building_size: Number.NaN })).toEqual(["smallest_building_size"]);
    expect(issuePaths({ statistics_year: Number.NaN })).toEqual([]);
  });

  it("only accepts listed choices", () => {
    expect(issuePaths({ source: "Elsewhere" })).toEqual(["source"]);
    expect(issuePaths({ statistics: ["population", "pets"] })).toEqual(["statistics.1"]);
  });
});

describe("defaultFormValues", () => {
  it("starts each field at its schema default, with empty optional fields", () => {
    const { fields } = datasetFormFields(argsSchema);

    expect(defaultFormValues(fields)).toMatchObject({
      source: "LM",
      year: 2025,
      calculate_heights: false,
      divisions: 4,
      statistics_year: Number.NaN,
      tree_type: "",
      statistics: [],
    });
  });
});

describe("jobParameters", () => {
  const { fields } = datasetFormFields(argsSchema);
  const defaults = defaultFormValues(fields);

  it("sends the area's bounds with every field's value", () => {
    const parameters = jobParameters(fields, { ...defaults, source: "OSM", divisions: 6 }, bounds);

    expect(parameters).toMatchObject({ bounds, source: "OSM", year: 2025, calculate_heights: false, divisions: 6 });
  });

  it("leaves out empty optional fields, so the engine applies its defaults", () => {
    const parameters = jobParameters(fields, defaults, bounds);

    expect(parameters).not.toHaveProperty("statistics_year");
    expect(parameters).not.toHaveProperty("tree_type");
    expect(parameters).not.toHaveProperty("statistics");
  });

  it("sends optional fields once they're filled in", () => {
    const parameters = jobParameters(
      fields,
      { ...defaults, statistics_year: 2023, tree_type: "dense", statistics: ["cars"] },
      bounds,
    );

    expect(parameters).toMatchObject({ statistics_year: 2023, tree_type: "dense", statistics: ["cars"] });
  });
});
