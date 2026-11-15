import type { Job } from "@repo/contracts";
import { drawsOnMap } from "@/lib/artifact-formats";

/** What a result layer says about its job: whether its result is on the map, and why not. */
export function layerStatus(job: Job | undefined): string {
  if (!job) return "Loading…";
  switch (job.state) {
    case "queued":
    case "running":
      return "Shows on the map when the job is done";
    case "failed":
      return job.error ?? "The job failed";
    case "cancelled":
      return "The job was cancelled";
    case "completed":
      return drawsOnMap(job.artifactFormat) ? "On the map" : "No file the map can draw";
  }
}
