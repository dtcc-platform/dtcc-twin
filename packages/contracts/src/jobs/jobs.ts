import { z } from "zod";
import { offsetPage } from "../common/pagination.js";
import { datasetNameParamsSchema } from "../datasets/datasets.js";

export const jobStateSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type JobState = z.infer<typeof jobStateSchema>;

export const jobProgressSchema = z.object({
  percent: z.number().min(0).max(100),
  message: z.string().nullable(),
  phase: z.string().nullable(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export const jobSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  dataset: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  state: jobStateSchema,
  progress: jobProgressSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const jobPageSchema = offsetPage(jobSchema);
export type JobPage = z.infer<typeof jobPageSchema>;

// Each Dataset defines its own parameters, which the engine validates. It always delivers a canonical package.
export const createJobBodySchema = z.strictObject({
  dataset: datasetNameParamsSchema.shape.name,
  parameters: z.record(z.string(), z.unknown()).refine((parameters) => !("format" in parameters), {
    path: ["format"],
    error: "isn't supported: every job is delivered as a .dtccpkg package",
  }),
});
export type CreateJobBody = z.infer<typeof createJobBodySchema>;
