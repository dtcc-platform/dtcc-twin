import { z } from "zod";

export const errorCodeSchema = z.enum([
  "ACCOUNT_DISABLED",
  "AGENT_AREA_TOO_LARGE",
  "AGENT_CHAT_BUSY",
  "AGENT_DAILY_LIMIT",
  "AGENT_UNAVAILABLE",
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "INTERNAL_ERROR",
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "SERVICE_UNAVAILABLE",
  "TOO_MANY_REQUESTS",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
