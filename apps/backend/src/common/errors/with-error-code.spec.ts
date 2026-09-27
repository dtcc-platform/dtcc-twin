import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { withErrorCode } from "./with-error-code.js";
import { toErrorBody } from "./to-error-body.js";

describe("withErrorCode", () => {
  it("carries a code the status alone would not produce", () => {
    const exception = new UnprocessableEntityException("Nothing to update", withErrorCode("VALIDATION_FAILED"));

    expect(toErrorBody(exception, "request-1")).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
  });

  it("leaves the status-derived code in place when none is attached", () => {
    expect(toErrorBody(new ConflictException("Already exists"), "request-1")).toMatchObject({ code: "CONFLICT" });
  });

  it("attaches the code as Nest's exception option, and only for codes the contract declares", () => {
    expect(withErrorCode("CONFLICT")).toEqual({ errorCode: "CONFLICT" });

    // @ts-expect-error a new code belongs in the contract's errorCodeSchema before anything can throw it
    withErrorCode("EMAIL_TAKEN");
  });
});
