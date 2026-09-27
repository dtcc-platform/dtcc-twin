import { describe, expect, it } from "vitest";
import { errorResponseSchema, errorBodySchema } from "./error-response.js";

const body = {
  status: 400,
  code: "VALIDATION_FAILED",
  message: "Invalid request body",
  requestId: "req-1",
  errors: [{ path: "address.street", message: "Required" }],
};

describe("errorBodySchema", () => {
  it("accepts an error body with field errors", () => {
    expect(errorBodySchema.parse(body)).toEqual(body);
  });

  it("accepts an error body without field errors", () => {
    const { errors: _errors, ...withoutErrors } = body;

    expect(errorBodySchema.parse(withoutErrors)).toEqual(withoutErrors);
  });

  it("rejects an unknown error code", () => {
    expect(errorBodySchema.safeParse({ ...body, code: "TEAPOT" }).success).toBe(false);
  });

  it("rejects a non-error status", () => {
    expect(errorBodySchema.safeParse({ ...body, status: 200 }).success).toBe(false);
  });
});

describe("errorResponseSchema", () => {
  it("accepts an error body wrapped in the envelope", () => {
    expect(errorResponseSchema.parse({ error: body })).toEqual({ error: body });
  });

  it("rejects a bare error body, so a response that is not ours cannot pass for one", () => {
    expect(errorResponseSchema.safeParse(body).success).toBe(false);
  });
});
