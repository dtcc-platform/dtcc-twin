import { z } from "zod";

// Payloads in DTCC Engine's own shape (DTCC Core's, snake_case); see docs/engine-contract.md.
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

export type EngineDataset = EngineDescriptor & {
  available: boolean;
};

/** One event from Core's ProgressTracker. */
export const engineProgressSchema = z.object({
  percent: z.number(),
  message: z.string().nullable(),
  phase: z.string().nullable(),
});
export type EngineProgress = z.infer<typeof engineProgressSchema>;

// `unknown`: the engine has no such job, for example because it expired or the engine restarted.
export type EngineJobStatus =
  | { state: "queued" | "completed" | "unknown" }
  | { state: "running"; progress: EngineProgress | null }
  | { state: "failed"; error: string };

// Core writes these as free text or as objects; only the parts Atlas shows are read.
const namedSchema = z.union([z.string(), z.looseObject({ name: z.string() })]);
const textListSchema = z.array(z.unknown()).transform((values) => values.filter((value) => typeof value === "string"));

/** A package's `manifest.json`: Core's legacy v2 and canonical v3 share these sections. */
export const engineManifestSchema = z.object({
  schema_version: z.string(),
  identity: z.object({ name: z.string(), title: z.string() }),
  metadata: z.object({
    description: z.string().default(""),
    provider: z.array(namedSchema).default([]),
    license: z.unknown(),
  }),
  provenance: z.object({
    processing_steps: textListSchema.default([]),
    generated_by: z.union([z.string(), z.looseObject({ package: z.string(), version: z.string() })]).nullish(),
  }),
  presentation: z.object({
    headline: z.string().nullish(),
    summary: z.string().nullish(),
    warnings: textListSchema.default([]),
    limitations: textListSchema.default([]),
  }),
  request: z.object({ parameters: z.record(z.string(), z.unknown()).default({}) }),
  artifacts: z.array(
    z.object({
      path: z.string(),
      role: z.string(),
      format: z.string(),
      media_type: z.string(),
      data_kind: z.string(),
      crs: z.string().nullish(),
      size: z.int().nullish(),
    }),
  ),
  warnings: textListSchema.default([]),
});
export type EngineManifest = z.infer<typeof engineManifestSchema>;
