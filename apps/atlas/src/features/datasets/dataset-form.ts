import type { CreateJobBody } from "@repo/contracts";
import { z } from "zod";

type Choice = string | number;

type FieldBase = { name: string; label: string; description?: string; optional: boolean };

type NumberLimits = { minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number };

/** One parameter of a Dataset, as the form shows it; built from the Dataset's JSON Schema. */
export type FormField = FieldBase &
  (
    | { kind: "boolean"; default: boolean }
    | { kind: "choice"; options: Choice[]; default: Choice | null }
    | { kind: "choices"; options: Choice[]; default: Choice[] | null }
    | ({ kind: "number" | "integer"; default: number | null } & NumberLimits)
    | { kind: "text"; default: string | null }
  );

/**
 * The form's values by field name: a boolean, a choice (`""` for none), an array of choices, a number (`NaN` for
 * empty) or a string.
 */
export type FormValues = Record<string, unknown>;

// Set by the app, not the user: bounds come from the selected area, and the package decides format and CRS.
const decidedByApp = new Set(["bounds", "format", "crs", "strict_live"]);

const choiceSchema = z.union([z.string(), z.number()]);

const shapeSchema = z.object({
  type: z.string().optional(),
  enum: z.array(choiceSchema).optional(),
  items: z.object({ enum: z.array(choiceSchema).optional() }).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  exclusiveMinimum: z.number().optional(),
  exclusiveMaximum: z.number().optional(),
});

// Only the parts of a Pydantic-generated JSON Schema property that the form understands.
const propertySchema = shapeSchema.extend({
  title: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  const: z.unknown().optional(),
  anyOf: z.array(shapeSchema).optional(),
});

type Property = z.infer<typeof propertySchema>;

const argsSchemaSchema = z.object({ properties: z.record(z.string(), propertySchema).default({}) });

/**
 * The form fields for a Dataset's `argsSchema`, in schema order. `omitted` names the parameters the form can't edit,
 * such as constants; the engine applies their defaults.
 */
export function datasetFormFields(argsSchema: Record<string, unknown>): { fields: FormField[]; omitted: string[] } {
  const { properties } = argsSchemaSchema.parse(argsSchema);
  const fields: FormField[] = [];
  const omitted: string[] = [];

  for (const [name, property] of Object.entries(properties)) {
    if (decidedByApp.has(name)) continue;
    const field = toField(name, property);
    if (field) fields.push(field);
    else omitted.push(name);
  }
  return { fields, omitted };
}

function toField(name: string, property: Property): FormField | undefined {
  if (property.const !== undefined) return undefined;

  // `anyOf: [X, { type: "null" }]` is how Pydantic writes an optional X.
  const alternatives = property.anyOf?.filter((shape) => shape.type !== "null");
  const optional = property.anyOf !== undefined;
  if (optional && alternatives?.length !== 1) return undefined;
  const shape = alternatives?.[0] ?? property;

  const base: FieldBase = { name, label: property.title ?? name, description: property.description, optional };
  const fallback = property.default;

  if (shape.enum) {
    return {
      ...base,
      kind: "choice",
      options: shape.enum,
      default: choiceSchema.nullable().catch(null).parse(fallback),
    };
  }
  if (shape.type === "array" && shape.items?.enum) {
    const defaults = z.array(choiceSchema).nullable().catch(null).parse(fallback);
    return { ...base, kind: "choices", options: shape.items.enum, default: defaults };
  }
  switch (shape.type) {
    case "boolean":
      return { ...base, kind: "boolean", default: fallback === true };
    case "number":
    case "integer":
      return {
        ...base,
        kind: shape.type,
        default: typeof fallback === "number" ? fallback : null,
        minimum: shape.minimum,
        maximum: shape.maximum,
        exclusiveMinimum: shape.exclusiveMinimum,
        exclusiveMaximum: shape.exclusiveMaximum,
      };
    case "string":
      return { ...base, kind: "text", default: typeof fallback === "string" ? fallback : null };
    default:
      return undefined;
  }
}

/** Validates the form's values with the limits the Dataset's schema declares. */
export function datasetFormSchema(fields: FormField[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field.name, valueSchema(field)])));
}

function valueSchema(field: FormField): z.ZodType {
  switch (field.kind) {
    case "boolean":
      return z.boolean();
    case "choice":
      return field.optional ? z.literal([...field.options, ""]) : z.literal(field.options);
    case "choices":
      return z.array(z.literal(field.options));
    case "number":
    case "integer": {
      let number = field.kind === "integer" ? z.int() : z.number();
      if (field.minimum !== undefined) number = number.min(field.minimum);
      if (field.maximum !== undefined) number = number.max(field.maximum);
      if (field.exclusiveMinimum !== undefined) number = number.gt(field.exclusiveMinimum);
      if (field.exclusiveMaximum !== undefined) number = number.lt(field.exclusiveMaximum);
      return field.optional ? z.union([number, z.nan()]) : number;
    }
    case "text":
      return z.string();
  }
}

export function defaultFormValues(fields: FormField[]): FormValues {
  return Object.fromEntries(fields.map((field) => [field.name, defaultValue(field)]));
}

function defaultValue(field: FormField): unknown {
  switch (field.kind) {
    case "boolean":
      return field.default;
    case "choice":
      return field.default ?? (field.optional ? "" : field.options[0]);
    case "choices":
      return field.default ?? [];
    case "number":
    case "integer":
      return field.default ?? Number.NaN;
    case "text":
      return field.default ?? "";
  }
}

/** The job's parameters: the area's bounds, and every field except empty optional ones, which the engine defaults. */
export function jobParameters(fields: FormField[], values: FormValues, bounds: number[]): CreateJobBody["parameters"] {
  const parameters: CreateJobBody["parameters"] = { bounds };
  for (const field of fields) {
    const value = values[field.name];
    if (field.optional && isEmpty(value)) continue;
    parameters[field.name] = value;
  }
  return parameters;
}

function isEmpty(value: unknown): boolean {
  return value === "" || Number.isNaN(value) || (Array.isArray(value) && value.length === 0);
}
