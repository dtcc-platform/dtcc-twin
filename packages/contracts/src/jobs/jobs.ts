import { z } from "zod";
import { offsetPage } from "../common/pagination.js";
import { datasetNameSchema } from "../datasets/datasets.js";

export const jobStateSchema = z.enum(["queued", "running", "completed", "failed"]);
export type JobState = z.infer<typeof jobStateSchema>;

/** Progress as DTCC Core measured it. Absent while running when Core reports none; never estimated. */
export const jobProgressSchema = z.object({
  percent: z.number().min(0).max(100),
  message: z.string(),
  phase: z.string().nullable(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export const jobSchema = z.object({
  id: z.uuid(),
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

// [minx, miny, maxx, maxy] or with z, in the Dataset's CRS (EPSG:3006 for every Dataset today).
const boundsSchema = z
  .array(z.number())
  .refine(
    isOrderedBounds,
    "must be [minx, miny, maxx, maxy] or [minx, miny, minz, maxx, maxy, maxz], each min below its max",
  );

function isOrderedBounds(bounds: number[]): boolean {
  if (bounds.length !== 4 && bounds.length !== 6) return false;
  const mins = bounds.slice(0, bounds.length / 2);
  const maxs = bounds.slice(bounds.length / 2);
  return mins.every((min, index) => min < (maxs[index] ?? Number.NEGATIVE_INFINITY));
}

// Parameters stay open: each Dataset declares its own in `argsSchema`, and the engine validates them.
export const createJobBodySchema = z.strictObject({
  dataset: datasetNameSchema,
  parameters: z.looseObject({ bounds: boundsSchema }),
});
export type CreateJobBody = z.infer<typeof createJobBodySchema>;

export const jobArtifactSchema = z.object({
  /** File name within the package's `artifacts/`; fetch it from `/jobs/:id/artifacts/:file`. */
  file: z.string(),
  role: z.string(),
  format: z.string(),
  mediaType: z.string(),
  dataKind: z.string(),
  crs: z.string().nullable(),
  size: z.int().nonnegative().nullable(),
});
export type JobArtifact = z.infer<typeof jobArtifactSchema>;

/** What a completed job produced, from its package manifest. */
export const jobResultSchema = z.object({
  schemaVersion: z.string(),
  title: z.string(),
  description: z.string(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  license: z.string().nullable(),
  providers: z.array(z.string()),
  processingSteps: z.array(z.string()),
  generatedBy: z.string().nullable(),
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
  parameters: z.record(z.string(), z.unknown()),
  artifacts: z.array(jobArtifactSchema),
});
export type JobResult = z.infer<typeof jobResultSchema>;

export const jobArtifactParamsSchema = z.object({
  id: z.uuid(),
  file: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9._-]+$/),
});
export type JobArtifactParams = z.infer<typeof jobArtifactParamsSchema>;
