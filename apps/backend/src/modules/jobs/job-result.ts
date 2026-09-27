import type { JobProgress, JobResult } from "@repo/contracts";
import type { EngineManifest, EngineProgress } from "../engine/engine.schemas.js";

const artifactsFolder = "artifacts/";

export function toJobResult(manifest: EngineManifest): JobResult {
  const { identity, metadata, provenance, presentation, request } = manifest;
  return {
    schemaVersion: manifest.schema_version,
    title: identity.title,
    description: metadata.description,
    headline: presentation.headline ?? null,
    summary: presentation.summary ?? null,
    license: typeof metadata.license === "string" ? metadata.license : null,
    providers: metadata.provider.map((provider) => (typeof provider === "string" ? provider : provider.name)),
    processingSteps: provenance.processing_steps,
    generatedBy: generatorOf(provenance.generated_by),
    warnings: [...presentation.warnings, ...manifest.warnings],
    limitations: presentation.limitations,
    parameters: request.parameters,
    artifacts: manifest.artifacts.map((artifact) => ({
      file: artifact.path.replace(artifactsFolder, ""),
      role: artifact.role,
      format: artifact.format,
      mediaType: artifact.media_type,
      dataKind: artifact.data_kind,
      crs: artifact.crs ?? null,
      size: artifact.size ?? null,
    })),
  };
}

export function artifactPath(file: string): string {
  return `${artifactsFolder}${file}`;
}

export function toJobProgress(progress: EngineProgress | null): JobProgress | null {
  if (!progress) return null;
  return {
    percent: Math.min(Math.max(progress.percent, 0), 100),
    message: progress.message ?? "",
    phase: progress.phase,
  };
}

function generatorOf(generatedBy: EngineManifest["provenance"]["generated_by"]): string | null {
  if (!generatedBy) return null;
  if (typeof generatedBy === "string") return generatedBy;
  return `${generatedBy.package} ${generatedBy.version}`;
}
