import { z } from "zod";
import { errorCodeSchema } from "./error-code.js";

export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const errorBodySchema = z.object({
  status: z.int().min(400).max(599),
  code: errorCodeSchema,
  message: z.string(),
  requestId: z.string(),
  errors: z.array(validationIssueSchema).optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

// A dedicated key, so an error page from a proxy or CDN can't be mistaken for one of ours.
export const errorResponseSchema = z.object({ error: errorBodySchema });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
