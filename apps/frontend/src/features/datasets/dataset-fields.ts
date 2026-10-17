import { z } from "zod";

type FieldBase = {
  /** The parameter's name in the job. */
  name: string;
  label: string;
  description: string | null;
  /** The field may be null, which leaves it to the Dataset's own default. */
  optional: boolean;
};

type Control =
  | { control: "switch"; default: boolean | null }
  | {
      control: "number";
      integer: boolean;
      minimum: number | null;
      maximum: number | null;
      exclusiveMinimum: number | null;
      exclusiveMaximum: number | null;
      default: number | null;
    }
  | {
      control: "text";
      minLength: number | null;
      maxLength: number | null;
      pattern: string | null;
      default: string | null;
    }
  | { control: "select"; options: (string | number)[]; default: string | number | null }
  | { control: "checkboxes"; options: string[]; default: string[] | null };

export type DatasetField = FieldBase & Control;

export type DatasetFields = {
  fields: DatasetField[];
  /** The parameters with no control, which keep the Dataset's default. */
  omitted: string[];
};

// bounds comes from the area, and the engine rejects format: every job is delivered as a package.
const hiddenFields = new Set(["bounds", "format"]);

const jsonObject = z.record(z.string(), z.unknown());

// The part of JSON Schema that pydantic writes for a Dataset's arguments.
const propertySchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  const: z.unknown().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  exclusiveMinimum: z.number().optional(),
  exclusiveMaximum: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  items: jsonObject.optional(),
  anyOf: z.array(jsonObject).optional(),
  $ref: z.string().optional(),
});
type Property = z.infer<typeof propertySchema>;

const argsSchemaSchema = z.object({
  properties: z.record(z.string(), jsonObject).optional(),
  $defs: z.record(z.string(), jsonObject).optional(),
});

/** The form fields for a Dataset's `argsSchema`, in the schema's order. */
export function datasetFields(argsSchema: Record<string, unknown>): DatasetFields {
  const schema = argsSchemaSchema.safeParse(argsSchema);
  if (!schema.success) return { fields: [], omitted: [] };
  const { properties = {}, $defs = {} } = schema.data;

  const fields: DatasetField[] = [];
  const omitted: string[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    // A constant can only be its value, so there is nothing to choose.
    if (hiddenFields.has(name) || "const" in raw) continue;
    const field = toField(name, raw, $defs);
    if (field) fields.push(field);
    else omitted.push(name);
  }
  return { fields, omitted };
}

function toField(
  name: string,
  raw: Record<string, unknown>,
  defs: Record<string, Record<string, unknown>>,
): DatasetField | null {
  const property = propertySchema.safeParse(raw);
  if (!property.success) return null;
  const unwrapped = unwrapOptional(property.data, defs);
  const control = unwrapped && controlOf(unwrapped.inner, property.data.default ?? null);
  if (!control) return null;

  // Label and help come from the field itself: an optional field's inner schema describes its type, not the field.
  const base: FieldBase = {
    name,
    label: property.data.title ?? humanize(name),
    description: property.data.description ?? null,
    optional: unwrapped.optional,
  };
  return { ...base, ...control };
}

/** An optional field is `anyOf` one type and null; any other `anyOf` has no control. */
function unwrapOptional(property: Property, defs: Record<string, Record<string, unknown>>) {
  if (!property.anyOf) {
    const inner = resolve(property, defs);
    return inner && { inner, optional: false };
  }

  const types = property.anyOf.filter((branch) => branch["type"] !== "null");
  if (types.length !== 1 || types.length === property.anyOf.length) return null;
  const branch = propertySchema.safeParse(types[0]);
  const inner = branch.success ? resolve(branch.data, defs) : null;
  return inner && { inner, optional: true };
}

/** Follows a `$ref` into the schema's `$defs`, where pydantic puts enums. */
function resolve(property: Property, defs: Record<string, Record<string, unknown>>): Property | null {
  if (!property.$ref) return property;
  const name = /^#\/\$defs\/(.+)$/.exec(property.$ref)?.[1];
  const target = propertySchema.safeParse(name === undefined ? undefined : defs[name]);
  return target.success ? target.data : null;
}

function controlOf(property: Property, defaultValue: unknown): Control | null {
  if (property.const !== undefined) return null;

  if (property.enum) {
    const options = property.enum;
    return { control: "select", options, default: options.find((option) => option === defaultValue) ?? null };
  }

  switch (property.type) {
    case "boolean":
      return { control: "switch", default: typeof defaultValue === "boolean" ? defaultValue : null };
    case "integer":
    case "number":
      return {
        control: "number",
        integer: property.type === "integer",
        minimum: property.minimum ?? null,
        maximum: property.maximum ?? null,
        exclusiveMinimum: property.exclusiveMinimum ?? null,
        exclusiveMaximum: property.exclusiveMaximum ?? null,
        default: typeof defaultValue === "number" ? defaultValue : null,
      };
    case "string":
      return {
        control: "text",
        minLength: property.minLength ?? null,
        maxLength: property.maxLength ?? null,
        pattern: property.pattern ?? null,
        default: typeof defaultValue === "string" ? defaultValue : null,
      };
    case "array":
      return checkboxesOf(property, defaultValue);
    default:
      return null;
  }
}

/** An array of enum strings is a set of choices; any other array has no control. */
function checkboxesOf(property: Property, defaultValue: unknown): Control | null {
  const items = propertySchema.safeParse(property.items);
  const options = items.success ? items.data.enum : undefined;
  if (!options?.every((option) => typeof option === "string")) return null;

  const valid = Array.isArray(defaultValue) && defaultValue.every((value) => options.includes(value as string));
  return { control: "checkboxes", options, default: valid ? (defaultValue as string[]) : null };
}

function humanize(name: string): string {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
