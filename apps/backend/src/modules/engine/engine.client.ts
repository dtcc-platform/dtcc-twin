import type { EngineDataset, EngineJobStatus } from "./engine.schemas.js";

/** DTCC Engine as the backend uses it. Inject this class; `EngineModule` picks the implementation. */
export abstract class EngineClient {
  abstract listDatasets(): Promise<EngineDataset[]>;

  /** Starts a job and returns the engine's id for it, without waiting for the Dataset. */
  abstract submitJob(dataset: string, parameters: Record<string, unknown>): Promise<string>;

  abstract getJob(engineJobId: string): Promise<EngineJobStatus>;

  /** The completed job's `.dtccpkg` archive. */
  abstract downloadPackage(engineJobId: string): Promise<Uint8Array>;
}
