import { z } from "zod";

// DTCC Engine's responses (apps/engine/dtcc_engine/api.py), reading only the fields the backend uses.

/** DTCC Core's `describe()` of a Dataset. */
export const engineDescriptorSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  data_category: z.string(),
  result_kind: z.string(),
  args_schema: z.record(z.string(), z.unknown()),
  timeout_hint: z.number().nullable(),
});
export type EngineDescriptor = z.infer<typeof engineDescriptorSchema>;

export const engineCatalogSchema = z.object({
  datasets: z.record(z.string(), engineDescriptorSchema),
});
