import { z } from "zod";
import type { SwerefBounds } from "@/features/area/area";
import type { DatasetField } from "./dataset-fields.ts";

/**
 * A Dataset form's values by field name: text for number, text and select fields, as their inputs hold them; a boolean
 * for a switch; the chosen options for a checkbox group. An empty value keeps the Dataset's default.
 */
export type DatasetFormValues = Record<string, string | boolean | string[]>;

/** Each field at its default. */
export function initialValues(fields: DatasetField[]): DatasetFormValues {
  return Object.fromEntries(fields.map((field) => [field.name, initialValue(field)]));
}

function initialValue(field: DatasetField): DatasetFormValues[string] {
  switch (field.control) {
    case "switch":
      return field.default ?? false;
    case "number":
    case "select":
      return field.default === null ? "" : String(field.default);
    case "text":
      return field.default ?? "";
    case "checkboxes":
      return field.default ?? [];
  }
}

/** The checks the schema states, worded for the form. An empty field passes: it keeps the Dataset's default. */
export function valuesSchema(fields: DatasetField[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field)])));
}

function fieldSchema(field: DatasetField) {
  switch (field.control) {
    case "switch":
      return z.boolean();
    case "number":
      return z.string().check((context) => {
        const text = context.value.trim();
        const problem = text === "" ? null : numberProblem(field, Number(text));
        if (problem) context.issues.push({ code: "custom", input: context.value, message: problem });
      });
    case "text":
      return z.string().check((context) => {
        const problem = context.value === "" ? null : textProblem(field, context.value);
        if (problem) context.issues.push({ code: "custom", input: context.value, message: problem });
      });
    case "select":
      return z.string().refine((value) => value === "" || field.options.some((option) => String(option) === value), {
        error: "Choose one of the options",
      });
    case "checkboxes":
      return z.array(z.string()).refine((values) => values.every((value) => field.options.includes(value)), {
        error: "Choose from the options",
      });
  }
}

function numberProblem(field: Extract<DatasetField, { control: "number" }>, value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a number";
  if (field.integer && !Number.isInteger(value)) return "Enter a whole number";
  if (field.minimum !== null && value < field.minimum) return `At least ${String(field.minimum)}`;
  if (field.exclusiveMinimum !== null && value <= field.exclusiveMinimum) {
    return `More than ${String(field.exclusiveMinimum)}`;
  }
  if (field.maximum !== null && value > field.maximum) return `At most ${String(field.maximum)}`;
  if (field.exclusiveMaximum !== null && value >= field.exclusiveMaximum) {
    return `Less than ${String(field.exclusiveMaximum)}`;
  }
  return null;
}

function textProblem(field: Extract<DatasetField, { control: "text" }>, value: string): string | null {
  if (field.minLength !== null && value.length < field.minLength)
    return `At least ${String(field.minLength)} characters`;
  if (field.maxLength !== null && value.length > field.maxLength)
    return `At most ${String(field.maxLength)} characters`;
  if (field.pattern !== null && !new RegExp(field.pattern).test(value)) return "Doesn't match the expected format";
  return null;
}

/**
 * The job's parameters: the area's bounds, and each field whose value differs from its default, as its schema's type.
 * Empty fields are left out, so the Dataset's own default applies.
 */
export function jobParameters(
  fields: DatasetField[],
  values: DatasetFormValues,
  bounds: SwerefBounds,
): Record<string, unknown> {
  const initial = initialValues(fields);
  const parameters: Record<string, unknown> = { bounds };
  for (const field of fields) {
    const value = toParameter(field, values[field.name]);
    // Compared as parameters, so "1.0" for a default of 1 is no change.
    if (value === undefined || JSON.stringify(value) === JSON.stringify(toParameter(field, initial[field.name]))) {
      continue;
    }
    parameters[field.name] = value;
  }
  return parameters;
}

/** A form value as the job's parameter, or undefined when it's empty. */
function toParameter(field: DatasetField, value: DatasetFormValues[string] | undefined): unknown {
  const text = typeof value === "string" ? value : "";
  switch (field.control) {
    case "switch":
      return value === true;
    case "number":
      return text.trim() === "" ? undefined : Number(text);
    case "text":
      return text === "" ? undefined : text;
    case "select":
      // The option itself, so a number stays a number.
      return field.options.find((option) => String(option) === text);
    case "checkboxes": {
      const chosen = field.options.filter((option) => Array.isArray(value) && value.includes(option));
      // An optional group left empty keeps its default; any other group sends its empty choice.
      return chosen.length === 0 && field.optional ? undefined : chosen;
    }
  }
}
