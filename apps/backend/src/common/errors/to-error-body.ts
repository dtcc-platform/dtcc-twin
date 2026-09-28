import { HttpException } from "@nestjs/common";
import { errorCodeSchema, type ErrorCode, type ErrorBody } from "@repo/contracts";
import { fromDatabaseError } from "./database-error.js";
import { ValidationException } from "./validation.exception.js";

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  503: "SERVICE_UNAVAILABLE",
};

export function toErrorBody(error: unknown, requestId: string): ErrorBody {
  // Why services never catch database errors: a duplicate or an outage becomes a 409 or 503 here.
  const exception = fromDatabaseError(error) ?? error;
  if (isExposedHttpError(exception)) {
    return {
      status: exception.status,
      code: codeByStatus[exception.status] ?? "BAD_REQUEST",
      message: exception.message,
      requestId,
    };
  }
  if (!(exception instanceof HttpException)) {
    // Unexpected errors can carry internals (SQL, secrets), so only the log sees them.
    return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error", requestId };
  }

  const status = exception.getStatus();
  const body: ErrorBody = { status, code: codeFor(exception, status), message: exception.message, requestId };
  if (exception instanceof ValidationException) {
    body.errors = exception.errors;
  }
  return body;
}

// body-parser's client errors (413, 415) arrive as `http-errors` objects, not Nest exceptions;
// `expose` marks their status and message as safe to send.
function isExposedHttpError(exception: unknown): exception is Error & { status: number } {
  return (
    exception instanceof Error &&
    "expose" in exception &&
    exception.expose === true &&
    "status" in exception &&
    typeof exception.status === "number"
  );
}

// An exception's own `errorCode` (Nest's HttpException option) wins when it is a known ErrorCode.
function codeFor(exception: HttpException, status: number): ErrorCode {
  const explicit = errorCodeSchema.safeParse(exception.errorCode);
  if (explicit.success) return explicit.data;
  return codeByStatus[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
}
