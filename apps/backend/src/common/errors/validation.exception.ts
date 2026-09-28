import { BadRequestException } from "@nestjs/common";
import type { ValidationIssue } from "@repo/contracts";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { withErrorCode } from "./with-error-code.js";

/** Thrown by the global validation pipe; its issues become `errors` in the error body. */
export class ValidationException extends BadRequestException {
  readonly errors: ValidationIssue[];

  constructor(issues: readonly StandardSchemaV1.Issue[]) {
    super("Request validation failed", withErrorCode("VALIDATION_FAILED"));
    this.errors = issues.map((issue) => ({
      path: (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)).join("."),
      message: issue.message,
    }));
  }
}
