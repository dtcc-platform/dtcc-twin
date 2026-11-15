import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { authQueries } from "@/api/auth";
import { jobMutations, jobQueries } from "@/api/jobs";
import { pendingDownloadStep } from "./pending-download-step.ts";
import {
  PendingDownloadsStoreContext,
  createPendingDownloadsStore,
  usePendingDownloadsStore,
  type PendingDownload,
} from "./pending-downloads-store.ts";

/** Keeps the logged-in user's pending downloads, on every page, and downloads each when its job completes. */
export function PendingDownloadsProvider({ children }: { children: ReactNode }) {
  // A fresh store whenever the logged-in user changes, so no one downloads another user's jobs.
  const userId = useQuery(authQueries.me()).data?.id ?? null;
  const [pending, setPending] = useState(() => ({ userId, store: createPendingDownloadsStore() }));
  if (pending.userId !== userId) setPending({ userId, store: createPendingDownloadsStore() });

  return (
    <PendingDownloadsStoreContext value={pending.store}>
      {children}
      <PendingDownloads />
    </PendingDownloadsStoreContext>
  );
}

function PendingDownloads() {
  const downloads = usePendingDownloadsStore((state) => state.downloads);
  return downloads.map((download) => <PendingJob key={download.jobId} download={download} />);
}

function PendingJob({ download: { jobId, title } }: { download: PendingDownload }) {
  const job = useQuery(jobQueries.detail(jobId));
  const { remove } = usePendingDownloadsStore((state) => state.actions);
  const { mutateAsync } = useMutation(jobMutations.download());
  // A lookup that failed even after its retries leaves nothing to wait for.
  const step = job.isError && !job.data ? "give-up" : pendingDownloadStep(job.data);
  const failure = job.data?.error ?? (job.isError ? job.error.message : "The job didn't complete");

  // An effect, since the job finishing is no user event. Only the run that removes the job goes on to download it.
  useEffect(() => {
    if (step === "wait" || !remove(jobId)) return;
    if (step === "give-up") {
      toast.error(`${title} has nothing to download`, { description: failure });
      return;
    }
    // The promise, not mutate's callbacks: removing the job has unmounted this before the download settles.
    mutateAsync({ id: jobId, file: step }).catch((error: unknown) => {
      toast.error(`${title} didn't download`, { description: error instanceof Error ? error.message : String(error) });
    });
  }, [step, failure, jobId, title, remove, mutateAsync]);

  return null;
}
