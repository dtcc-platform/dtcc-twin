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

export const engineSubmittedSchema = z.object({ job_id: z.uuid() });

/** The 503 of a submission the queue didn't confirm: the job may still run. */
export const engineUnconfirmedSchema = z.object({ detail: z.object({ job_id: z.uuid() }) });

export const engineRejectionSchema = z.object({
  detail: z.union([
    z.string(),
    z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])), type: z.string() })),
  ]),
});
export type EngineRejection = z.infer<typeof engineRejectionSchema>["detail"];

export const engineJobSchema = z.object({
  state: z.enum(["unconfirmed", "queued", "running", "completed", "failed", "cancelled"]),
  progress: z.object({ percent: z.number(), message: z.string().nullish(), phase: z.string().nullish() }).nullable(),
  error: z.object({ type: z.string() }).nullable(),
  package: z.object({ available: z.boolean() }).nullable(),
});
export type EngineJobStatus = z.infer<typeof engineJobSchema>;
