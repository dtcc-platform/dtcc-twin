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
  const { mutate, isIdle } = useMutation(jobMutations.download());
  const step = pendingDownloadStep(job.data);

  // An effect, since the job finishing is no user event. Waiting ends once the download has started, so it runs once.
  useEffect(() => {
    if (step === "wait" || !isIdle) return;
    if (step === "give-up") {
      toast.error(`${title} has nothing to download`, { description: "The job didn't complete" });
      remove(jobId);
      return;
    }
    mutate(
      { id: jobId, file: step },
      {
        onError: (error) => toast.error(error.message),
        onSettled: () => {
          remove(jobId);
        },
      },
    );
  }, [step, isIdle, jobId, title, remove, mutate]);

  return null;
}
