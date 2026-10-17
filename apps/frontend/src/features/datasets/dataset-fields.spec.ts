import { describe, expect, it } from "vitest";
import { datasetFields, type DatasetField } from "./dataset-fields.ts";

// The properties below are real Dataset arguments, as pydantic writes them into the engine's argsSchema.

const bounds = { items: { type: "number" }, title: "Bounds", type: "array" };
const format = { anyOf: [{ enum: ["obj", "stl"], type: "string" }, { type: "null" }], default: null, title: "Format" };

function fieldsOf(properties: Record<string, unknown>, $defs?: Record<string, unknown>) {
  return datasetFields({ type: "object", properties, required: ["bounds"], ...($defs && { $defs }) });
}

function fieldOf(name: string, property: unknown, $defs?: Record<string, unknown>): DatasetField | undefined {
  return fieldsOf({ [name]: property }, $defs).fields[0];
}

describe("datasetFields", () => {
  it("makes a boolean a switch", () => {
    const strictLive = {
      default: false,
      description: "Raise a typed upstream error.",
      title: "Strict Live",
      type: "boolean",
    };

    expect(fieldOf("strict_live", strictLive)).toEqual({
      name: "strict_live",
      label: "Strict Live",
      description: "Raise a typed upstream error.",
      optional: false,
      control: "switch",
      default: false,
    });
  });

  it("makes an integer a whole-number input with its limits", () => {
    const degree = {
      default: 1,
      description: "Polynomial degree",
      maximum: 3,
      minimum: 1,
      title: "Degree",
      type: "integer",
    };

    expect(fieldOf("degree", degree)).toMatchObject({
      control: "number",
      integer: true,
      minimum: 1,
      maximum: 3,
      exclusiveMinimum: null,
      exclusiveMaximum: null,
      default: 1,
    });
  });

  it("makes a number a decimal input, with an exclusive minimum", () => {
    const kappa = { default: 1.0, exclusiveMinimum: 0, title: "Kappa", type: "number" };

    expect(fieldOf("kappa", kappa)).toMatchObject({
      control: "number",
      integer: false,
      minimum: null,
      exclusiveMinimum: 0,
      default: 1,
    });
  });

  it("makes a string a text input, with its length limits", () => {
    const phenomenon = { default: "NO2", minLength: 1, title: "Phenomenon", type: "string" };

    expect(fieldOf("phenomenon", phenomenon)).toMatchObject({
      control: "text",
      minLength: 1,
      maxLength: null,
      pattern: null,
      default: "NO2",
    });
  });

  it("makes a string enum a select", () => {
    const wallBcType = {
      default: "robin",
      enum: ["dirichlet", "neumann", "robin"],
      title: "Wall Bc Type",
      type: "string",
    };

    expect(fieldOf("wall_bc_type", wallBcType)).toMatchObject({
      control: "select",
      options: ["dirichlet", "neumann", "robin"],
      default: "robin",
    });
  });

  it("makes an integer enum a select of numbers", () => {
    const year = { default: 2025, enum: [2018, 2025], title: "Year", type: "integer" };

    expect(fieldOf("year", year)).toMatchObject({ control: "select", options: [2018, 2025], default: 2025 });
  });

  it("makes an array of enum values a checkbox group", () => {
    const options = ["connectivity", "reach", "mean_depth", "integration", "choice"];
    const measures = { default: options, items: { enum: options, type: "string" }, title: "Measures", type: "array" };

    expect(fieldOf("measures", measures)).toMatchObject({ control: "checkboxes", options, default: options });
  });

  describe("an optional field, one type or null", () => {
    it("gets the control of its type, and keeps its own title, description and default", () => {
      const crs = {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: "EPSG:3006",
        description: "Coordinate reference system.",
        title: "Crs",
      };

      expect(fieldOf("crs", crs)).toMatchObject({
        control: "text",
        label: "Crs",
        description: "Coordinate reference system.",
        optional: true,
        default: "EPSG:3006",
      });
    });

    it("defaults to null when the schema does", () => {
      const options = ["bus", "tram", "train", "metro", "ferry"];
      const modes = {
        anyOf: [{ items: { enum: options, type: "string" }, type: "array" }, { type: "null" }],
        default: null,
        title: "Modes",
      };

      expect(fieldOf("modes", modes)).toMatchObject({ control: "checkboxes", optional: true, options, default: null });
    });

    it("follows a reference into the schema's definitions, labelled by its name when it has no title", () => {
      const lod = {
        anyOf: [{ $ref: "#/$defs/GeometryType" }, { type: "null" }],
        default: null,
        description: "Optional level of detail",
      };
      const geometryType = { description: "Geometry types.", enum: [1, 2, 3], title: "GeometryType", type: "integer" };

      expect(fieldOf("lod", lod, { GeometryType: geometryType })).toMatchObject({
        control: "select",
        label: "Lod",
        description: "Optional level of detail",
        optional: true,
        options: [1, 2, 3],
        default: null,
      });
    });
  });

  it("drops a default that doesn't fit the control", () => {
    const mode = { default: "c", enum: ["a", "b"], title: "Mode", type: "string" };

    expect(fieldOf("mode", mode)).toMatchObject({ control: "select", default: null });
  });

  it("keeps the schema's order", () => {
    const { fields } = fieldsOf({
      kappa: { default: 1.0, title: "Kappa", type: "number" },
      degree: { default: 1, title: "Degree", type: "integer" },
      strict_live: { default: false, title: "Strict Live", type: "boolean" },
    });

    expect(fields.map((field) => field.name)).toEqual(["kappa", "degree", "strict_live"]);
  });

  it("hides bounds, format and constants, without listing them as left out", () => {
    const source = { const: "LM", default: "LM", title: "Source", type: "string" };

    expect(fieldsOf({ bounds, format, source })).toEqual({ fields: [], omitted: [] });
  });

  it("leaves out the fields it has no control for, and lists them", () => {
    const { fields, omitted } = fieldsOf({
      parameters: { default: [1, 3], items: {}, title: "Parameters", type: "array" },
      operators: { anyOf: [{ items: { type: "string" }, type: "array" }, { type: "null" }], default: null },
      tetgen_switches: { anyOf: [{ additionalProperties: true, type: "object" }, { type: "null" }], default: null },
      classifications: {
        anyOf: [
          { type: "integer" },
          { items: { type: "integer" }, type: "array" },
          { enum: ["all", "terrain"], type: "string" },
        ],
        default: "all",
      },
      tetgen_debug_output_dir: {
        anyOf: [{ type: "string" }, { format: "path", type: "string" }, { type: "null" }],
        default: null,
      },
    });

    expect(fields).toEqual([]);
    expect(omitted).toEqual([
      "parameters",
      "operators",
      "tetgen_switches",
      "classifications",
      "tetgen_debug_output_dir",
    ]);
  });

  it("has nothing to show for a schema without properties", () => {
    expect(datasetFields({})).toEqual({ fields: [], omitted: [] });
  });
});
