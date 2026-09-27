import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { toErrorBody } from "./to-error-body.js";
import { ValidationException } from "./validation.exception.js";

const requestId = "request-1";

describe("toErrorBody", () => {
  it("maps a validation exception to VALIDATION_FAILED with dotted issue paths", () => {
    const exception = new ValidationException([
      { message: "Too small", path: ["items", 0, { key: "name" }] },
      { message: 'Unrecognized key: "nmae"' },
    ]);

    expect(toErrorBody(exception, requestId)).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Request validation failed",
      requestId,
      errors: [
        { path: "items.0.name", message: "Too small" },
        { path: "", message: 'Unrecognized key: "nmae"' },
      ],
    });
  });

  it("derives the code from the status of an HttpException", () => {
    expect(toErrorBody(new NotFoundException("Example not found"), requestId)).toEqual({
      status: 404,
      code: "NOT_FOUND",
      message: "Example not found",
      requestId,
    });
  });

  it("maps 4xx statuses without a code of their own to BAD_REQUEST", () => {
    expect(toErrorBody(new UnprocessableEntityException(), requestId)).toMatchObject({
      status: 422,
      code: "BAD_REQUEST",
    });
  });

  it("maps a 413 to PAYLOAD_TOO_LARGE", () => {
    expect(toErrorBody(new PayloadTooLargeException(), requestId)).toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("maps an exposed http-errors error, as body-parser throws, like an HttpException", () => {
    const error = Object.assign(new Error("request entity too large"), { status: 413, expose: true });

    expect(toErrorBody(error, requestId)).toEqual({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "request entity too large",
      requestId,
    });
  });

  it("does not trust a status on an error that is not marked exposed", () => {
    const error = Object.assign(new Error("password=hunter2"), { status: 400 });

    expect(toErrorBody(error, requestId)).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });

  it("maps a 503 to SERVICE_UNAVAILABLE", () => {
    expect(toErrorBody(new ServiceUnavailableException("Shutting down"), requestId)).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Shutting down",
    });
  });

  it("maps 5xx statuses without a code of their own to INTERNAL_ERROR and keeps their message", () => {
    expect(toErrorBody(new BadGatewayException("Upstream down"), requestId)).toMatchObject({
      status: 502,
      code: "INTERNAL_ERROR",
      message: "Upstream down",
    });
  });

  it("prefers a known errorCode set on the exception", () => {
    const exception = new UnprocessableEntityException("Nothing to update", { errorCode: "VALIDATION_FAILED" });

    expect(toErrorBody(exception, requestId)).toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
  });

  it("ignores an errorCode that is not an ErrorCode", () => {
    const exception = new BadRequestException("Odd request", { errorCode: "TEAPOT" });

    expect(toErrorBody(exception, requestId)).toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("hides the details of unexpected errors", () => {
    expect(toErrorBody(new Error("password=hunter2"), requestId)).toEqual({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId,
    });
  });
});
