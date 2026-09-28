import type { HttpExceptionOptions } from "@nestjs/common";
import type { ErrorCode } from "@repo/contracts";

/**
 * A specific `ErrorCode` for a failure the status alone can't distinguish:
 * `new ConflictException(message, withErrorCode("…"))`. Nest's own option takes any string.
 */
export function withErrorCode(code: ErrorCode): HttpExceptionOptions {
  return { errorCode: code };
}
