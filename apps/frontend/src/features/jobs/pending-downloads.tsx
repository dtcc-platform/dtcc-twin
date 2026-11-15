import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { jobMutations, jobQueries } from "@/api/jobs";
import { pendingDownloadStep } from "./pending-download-step.ts";
import { usePendingDownloadsStore, type PendingDownload } from "./pending-downloads-store.ts";

/** Downloads each pending job's file once the job has completed. Shows nothing. */
export function PendingDownloads() {
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
