import { z } from "zod";

export const datasetSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  dataCategory: z.string(),
  resultKind: z.string(),
  argsSchema: z.record(z.string(), z.unknown()),
  timeoutHint: z.number().nullable(),
});
export type Dataset = z.infer<typeof datasetSchema>;

export const datasetListSchema = z.object({ items: z.array(datasetSchema) });
export type DatasetList = z.infer<typeof datasetListSchema>;

export const datasetNameParamsSchema = z.object({ name: z.string().regex(/^[a-z0-9_]{1,100}$/) });
export type DatasetNameParams = z.infer<typeof datasetNameParamsSchema>;
