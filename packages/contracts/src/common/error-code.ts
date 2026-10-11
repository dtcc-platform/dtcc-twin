import { z } from "zod";

export const errorCodeSchema = z.enum([
  // Login with the right password, refused because an admin disabled the account.
  "ACCOUNT_DISABLED",
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "INTERNAL_ERROR",
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "SERVICE_UNAVAILABLE",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
