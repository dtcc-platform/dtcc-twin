import type { Job } from "@repo/contracts";
import type { JobFile } from "@/api/jobs";

/** What to do about a pending download: wait for its job, give up on it, or download one of its files. */
export function pendingDownloadStep(job: Job | undefined): "wait" | "give-up" | JobFile {
  if (!job) return "wait";
  switch (job.state) {
    case "queued":
    case "running":
      return "wait";
    case "failed":
    case "cancelled":
      return "give-up";
    case "completed":
      return job.artifactFormat ? "artifact" : "package";
  }
}
