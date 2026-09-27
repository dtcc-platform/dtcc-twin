import { z } from "zod";
import { offsetPage } from "../common/pagination.js";

// Categories and result kinds are open sets owned by DTCC Core, so they stay plain strings.
export const datasetSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  dataCategory: z.string(),
  resultKind: z.string(),
  /** JSON Schema of the Dataset's parameters, as DTCC Core generates it. */
  argsSchema: z.record(z.string(), z.unknown()),
  /** Expected run time in seconds, when DTCC Core gives one. */
  timeoutHint: z.number().nonnegative().nullable(),
  /** Whether a job can run this Dataset right now. */
  available: z.boolean(),
});
export type Dataset = z.infer<typeof datasetSchema>;

export const datasetPageSchema = offsetPage(datasetSchema);
export type DatasetPage = z.infer<typeof datasetPageSchema>;

export const datasetNameSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9_]+$/);

export const datasetNameParamsSchema = z.object({
  name: datasetNameSchema,
});
export type DatasetNameParams = z.infer<typeof datasetNameParamsSchema>;
