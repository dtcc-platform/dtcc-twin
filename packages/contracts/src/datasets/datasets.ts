import { z } from "zod";

export const datasetSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  dataCategory: z.string(),
  resultKind: z.string(),
  argsSchema: z.record(z.string(), z.unknown()),
  /** Per product, the formats of an extra file a job can add to its package; `null` is a Dataset's only product. */
  artifactFormats: z.array(
    z.object({
      product: z.string().nullable(),
      formats: z.array(
        z.object({
          format: z.string(),
          /** The parameter values the format needs, such as `{ slice_axis: "z" }`. */
          requires: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
  ),
  timeoutHint: z.number().nullable(),
});
export type Dataset = z.infer<typeof datasetSchema>;

export const datasetListSchema = z.object({ items: z.array(datasetSchema) });
export type DatasetList = z.infer<typeof datasetListSchema>;

export const datasetNameParamsSchema = z.object({ name: z.string().regex(/^[a-z0-9_]{1,100}$/) });
export type DatasetNameParams = z.infer<typeof datasetNameParamsSchema>;
