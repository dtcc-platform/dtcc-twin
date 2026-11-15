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
  artifactFormat: z.string().nullable(),
  state: jobStateSchema,
  progress: jobProgressSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

/** The extra file in a completed job's package: its format, where the map places it, and its legend. */
export const jobArtifactMetadataSchema = z.object({
  format: z.string(),
  /**
   * A PNG's west, south, east and north edges in longitude and latitude, its corners on the map. A GeoTIFF's only
   * enclose it, as its grid isn't north-up; null for GeoJSON, which places itself.
   */
  boundsWgs84: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** What an image's colors stand for; null for one in its own colors, such as an aerial photo. */
  legend: z
    .object({
      field: z.string().nullable(),
      unit: z.string().nullable(),
      valueRange: z.tuple([z.number(), z.number()]),
      colormap: z.string(),
    })
    .nullable(),
});
export type JobArtifactMetadata = z.infer<typeof jobArtifactMetadataSchema>;

export const jobPageSchema = offsetPage(jobSchema);
export type JobPage = z.infer<typeof jobPageSchema>;

// Each Dataset defines its own parameters, which the engine validates. It always delivers a canonical package.
export const createJobBodySchema = z.strictObject({
  dataset: datasetNameParamsSchema.shape.name,
  parameters: z.record(z.string(), z.unknown()).refine((parameters) => !("format" in parameters), {
    path: ["format"],
    error: "isn't supported: every job is delivered as a .dtccpkg package",
  }),
  /** The format of an extra file in the package, one of the Dataset's `artifactFormats` for the job's product. */
  artifactFormat: z
    .string()
    .regex(/^[a-z0-9_]{1,20}$/)
    .optional(),
});
export type CreateJobBody = z.infer<typeof createJobBodySchema>;
