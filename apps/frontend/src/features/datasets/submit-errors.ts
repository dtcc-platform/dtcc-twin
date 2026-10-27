import { ApiError } from "@/api/client/api-error";
import { humanize, type DatasetField } from "./dataset-fields.ts";

/** Why submitting a Dataset's form failed: messages by field name, and messages for above the form. */
export type SubmitErrors = { fields: Record<string, string>; form: string[] };

// The engine reports pydantic's error type, not its message, which can echo what was sent.
const pydanticWording = new Map(
  Object.entries({
    missing: "Required",
    extra_forbidden: "Not a setting of this Dataset",
    literal_error: "Not one of the options",
    enum: "Not one of the options",
    bool_type: "Must be on or off",
    bool_parsing: "Must be on or off",
    int_type: "Enter a whole number",
    int_parsing: "Enter a whole number",
    int_from_float: "Enter a whole number",
    float_type: "Enter a number",
    float_parsing: "Enter a number",
    finite_number: "Enter a finite number",
    greater_than: "Too small",
    greater_than_equal: "Too small",
    less_than: "Too large",
    less_than_equal: "Too large",
    string_type: "Enter text",
    string_too_short: "Too short",
    string_too_long: "Too long",
    string_pattern_mismatch: "Doesn't match the expected format",
    list_type: "Must be a list",
    tuple_type: "Must be a list",
    too_short: "Too few chosen",
    too_long: "Too many chosen",
  }),
);

const pydanticCode = /^[a-z]+(_[a-z]+)*$/;

/** A failed submit's errors, on the form's fields where the server names one, and above the form otherwise. */
export function submitErrors(fields: DatasetField[], error: Error): SubmitErrors {
  if (!(error instanceof ApiError) || error.body?.code !== "VALIDATION_FAILED") {
    return { fields: {}, form: [error.message] };
  }

  const shown = new Set(fields.map((field) => field.name));
  const result: SubmitErrors = { fields: {}, form: [] };
  for (const issue of error.body.errors ?? []) {
    const message = wording(issue.message);
    // `parameters.modes.0` is the first item of modes; the backend's own checks can name other parts of the request.
    const [root, name] = issue.path.split(".");
    if (root !== "parameters") result.form.push(`${humanize(issue.path)}: ${message}`);
    else if (name === undefined) result.form.push(`These settings don't work together: ${message}`);
    else if (name === "bounds") result.form.push(`The area doesn't suit this Dataset: ${message}`);
    else if (name === "<unexpected>") result.form.push("A setting this Dataset doesn't have was sent");
    else if (shown.has(name)) result.fields[name] ??= message;
    else result.form.push(`${humanize(name)}: ${message}`);
  }
  return result;
}

/** Our wording for a pydantic error code; a message that is already words, from the backend's own checks, as it is. */
function wording(message: string): string {
  return pydanticWording.get(message) ?? (pydanticCode.test(message) ? "Not a valid value" : message);
}
