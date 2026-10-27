import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client/api-error";
import { datasetFields } from "./dataset-fields.ts";
import { submitErrors } from "./submit-errors.ts";

const { fields } = datasetFields({
  properties: {
    degree: { default: 1, maximum: 3, minimum: 1, title: "Degree", type: "integer" },
    wall_bc_type: { default: "robin", enum: ["dirichlet", "neumann", "robin"], title: "Wall Bc Type", type: "string" },
    modes: {
      anyOf: [{ items: { enum: ["bus", "tram"], type: "string" }, type: "array" }, { type: "null" }],
      default: null,
      title: "Modes",
    },
    parameters: { default: [1, 3], items: {}, title: "Parameters", type: "array" },
  },
});

/** The backend's 400 for rejected parameters: the engine's pydantic error codes, under `parameters.`. */
function validationFailed(...errors: { path: string; message: string }[]): ApiError {
  return new ApiError(400, {
    error: { status: 400, code: "VALIDATION_FAILED", message: "Request validation failed", requestId: "r1", errors },
  });
}

describe("submitErrors", () => {
  it("puts an error on the field it names, worded from its code", () => {
    const error = validationFailed(
      { path: "parameters.degree", message: "less_than_equal" },
      { path: "parameters.wall_bc_type", message: "literal_error" },
    );

    expect(submitErrors(fields, error)).toEqual({
      fields: { degree: "Too large", wall_bc_type: "Not one of the options" },
      form: [],
    });
  });

  it("puts an error on one item of a list on the list's field", () => {
    const error = validationFailed({ path: "parameters.modes.0", message: "literal_error" });

    expect(submitErrors(fields, error)).toEqual({ fields: { modes: "Not one of the options" }, form: [] });
  });

  it("words a code it doesn't know generically", () => {
    const error = validationFailed({ path: "parameters.degree", message: "some_new_pydantic_error" });

    expect(submitErrors(fields, error).fields).toEqual({ degree: "Not a valid value" });
  });

  it("keeps a message that is already words, from the backend's own checks", () => {
    const error = validationFailed({ path: "parameters.degree", message: "Expected a number, received a string" });

    expect(submitErrors(fields, error).fields).toEqual({ degree: "Expected a number, received a string" });
  });

  it("explains an error in the area's bounds above the form", () => {
    const error = validationFailed({ path: "parameters.bounds", message: "value_error" });

    expect(submitErrors(fields, error)).toEqual({
      fields: {},
      form: ["The area doesn't suit this Dataset: Not a valid value"],
    });
  });

  it("explains an error across several fields above the form", () => {
    const error = validationFailed({ path: "parameters", message: "value_error" });

    expect(submitErrors(fields, error).form).toEqual(["These settings don't work together: Not a valid value"]);
  });

  it("names a field the form doesn't show above the form", () => {
    const error = validationFailed(
      { path: "parameters.parameters.1", message: "int_parsing" },
      { path: "parameters.<unexpected>", message: "extra_forbidden" },
    );

    expect(submitErrors(fields, error)).toEqual({
      fields: {},
      form: ["Parameters: Enter a whole number", "A setting this Dataset doesn't have was sent"],
    });
  });

  it("shows any other failure above the form, with its message", () => {
    const rejected = new ApiError(400, {
      error: { status: 400, code: "BAD_REQUEST", message: "Unknown dataset 'nope'", requestId: "r1" },
    });

    expect(submitErrors(fields, rejected)).toEqual({ fields: {}, form: ["Unknown dataset 'nope'"] });
    expect(submitErrors(fields, new Error("Network Error"))).toEqual({ fields: {}, form: ["Network Error"] });
  });
});
