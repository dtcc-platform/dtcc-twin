import { describe, expect, it } from "vitest";
import type { SwerefBounds } from "@/features/area/area";
import { datasetFields } from "./dataset-fields.ts";
import { initialValues, jobParameters, valuesSchema, type DatasetFormValues } from "./dataset-values.ts";

// One field of every control, from real Dataset arguments.
const { fields } = datasetFields({
  properties: {
    strict_live: { default: false, title: "Strict Live", type: "boolean" },
    degree: { default: 1, maximum: 3, minimum: 1, title: "Degree", type: "integer" },
    kappa: { default: 1.0, exclusiveMinimum: 0, title: "Kappa", type: "number" },
    phenomenon: { default: "NO2", minLength: 1, title: "Phenomenon", type: "string" },
    wall_bc_type: { default: "robin", enum: ["dirichlet", "neumann", "robin"], title: "Wall Bc Type", type: "string" },
    year: { default: 2025, enum: [2018, 2025], title: "Year", type: "integer" },
    lod: { anyOf: [{ enum: [1, 2, 3], type: "integer" }, { type: "null" }], default: null },
    max_vehicles: { anyOf: [{ type: "integer" }, { type: "null" }], default: null, title: "Max Vehicles" },
    measures: {
      default: ["reach", "choice"],
      items: { enum: ["connectivity", "reach", "choice"], type: "string" },
      title: "Measures",
      type: "array",
    },
    modes: {
      anyOf: [{ items: { enum: ["bus", "tram", "ferry"], type: "string" }, type: "array" }, { type: "null" }],
      default: null,
      title: "Modes",
    },
  },
});

const bounds: SwerefBounds = [319891, 6399790, 320091, 6399990];

function errorsOf(values: DatasetFormValues): Record<string, string> {
  const result = valuesSchema(fields).safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("initialValues", () => {
  it("starts each field at its default, as the form holds it", () => {
    expect(initialValues(fields)).toEqual({
      strict_live: false,
      degree: "1",
      kappa: "1",
      phenomenon: "NO2",
      wall_bc_type: "robin",
      year: "2025",
      lod: "",
      max_vehicles: "",
      measures: ["reach", "choice"],
      modes: [],
    });
  });
});

describe("valuesSchema", () => {
  it("accepts the defaults", () => {
    expect(errorsOf(initialValues(fields))).toEqual({});
  });

  it("accepts empty fields, which keep the Dataset's default", () => {
    expect(errorsOf({ ...initialValues(fields), degree: "", phenomenon: "", lod: "", year: "" })).toEqual({});
  });

  it("asks for a number, and a whole one for an integer", () => {
    expect(errorsOf({ ...initialValues(fields), kappa: "warm", degree: "1.5" })).toEqual({
      kappa: "Enter a number",
      degree: "Enter a whole number",
    });
  });

  it("checks a number's limits", () => {
    expect(errorsOf({ ...initialValues(fields), degree: "4", kappa: "0" })).toEqual({
      degree: "At most 3",
      kappa: "More than 0",
    });
    expect(errorsOf({ ...initialValues(fields), degree: "0" })).toEqual({ degree: "At least 1" });
  });

  it("checks a text's length", () => {
    const { fields: limited } = datasetFields({
      properties: { code: { maxLength: 3, title: "Code", type: "string" } },
    });

    expect(valuesSchema(limited).safeParse({ code: "abcd" }).error?.issues[0]?.message).toBe("At most 3 characters");
  });

  it("only accepts a select's options", () => {
    expect(errorsOf({ ...initialValues(fields), wall_bc_type: "periodic" })).toEqual({
      wall_bc_type: "Choose one of the options",
    });
  });

  it("only accepts a checkbox group's options", () => {
    expect(errorsOf({ ...initialValues(fields), measures: ["reach", "speed"] })).toEqual({
      measures: "Choose from the options",
    });
  });
});

describe("jobParameters", () => {
  it("sends only the bounds when nothing changed", () => {
    expect(jobParameters(fields, initialValues(fields), bounds)).toEqual({ bounds });
  });

  it("sends each changed field as its type", () => {
    const values = {
      ...initialValues(fields),
      strict_live: true,
      degree: "2",
      kappa: "0.5",
      phenomenon: "PM10",
      wall_bc_type: "neumann",
      year: "2018",
      lod: "3",
      max_vehicles: "100",
      measures: ["choice", "connectivity"],
      modes: ["tram"],
    };

    expect(jobParameters(fields, values, bounds)).toEqual({
      bounds,
      strict_live: true,
      degree: 2,
      kappa: 0.5,
      phenomenon: "PM10",
      wall_bc_type: "neumann",
      year: 2018,
      lod: 3,
      max_vehicles: 100,
      measures: ["connectivity", "choice"],
      modes: ["tram"],
    });
  });

  it("leaves out empty fields, so the Dataset's default applies", () => {
    const values = { ...initialValues(fields), degree: "", phenomenon: "", year: "", modes: [] };

    expect(jobParameters(fields, values, bounds)).toEqual({ bounds });
  });

  it("leaves out a value equal to the default, however it was typed", () => {
    expect(jobParameters(fields, { ...initialValues(fields), kappa: "1.0", degree: " 1 " }, bounds)).toEqual({
      bounds,
    });
  });

  it("sends an emptied checkbox group that isn't optional, since empty is a choice there", () => {
    expect(jobParameters(fields, { ...initialValues(fields), measures: [] }, bounds)).toEqual({ bounds, measures: [] });
  });
});
