import type { Job, JobState } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { BanIcon, CircleCheckIcon, CircleXIcon, ClockIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { jobMutations } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/relative-time";

const stateLabels: Record<JobState, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function StateIcon({ state }: { state: JobState }) {
  switch (state) {
    case "queued":
      return <ClockIcon className="size-4 text-muted-foreground" />;
    case "running":
      return <Spinner className="text-primary" />;
    case "completed":
      return <CircleCheckIcon className="size-4 text-green-600" />;
    case "failed":
      return <CircleXIcon className="size-4 text-destructive" />;
    case "cancelled":
      return <BanIcon className="size-4 text-muted-foreground" />;
  }
}

/** One job in the Downloads panel: its state and progress, and its package once it has one. */
export function JobItem({ job, title }: { job: Job; title: string }) {
  const download = useMutation(jobMutations.download());

  return (
    <li className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5" aria-hidden>
          <StateIcon state={job.state} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {stateLabels[job.state]} · {formatRelativeTime(job.createdAt)}
          </p>
        </div>
        {job.state === "completed" && (
          <Button
            variant="outline"
            size="sm"
            disabled={download.isPending}
            onClick={() => {
              download.mutate(job.id, { onError: (error) => toast.error(error.message) });
            }}
          >
            <DownloadIcon />
            Download
          </Button>
        )}
      </div>
      {job.state === "running" && (
        <div className="flex flex-col gap-1">
          {/* Null is indeterminate: the engine hasn't reported any progress yet. */}
          <Progress value={job.progress?.percent ?? null} aria-label={`Progress of ${title}`} />
          {job.progress && (
            <p className="truncate text-xs text-muted-foreground">
              {Math.round(job.progress.percent)}%
              {(job.progress.message ?? job.progress.phase) && ` · ${job.progress.message ?? job.progress.phase ?? ""}`}
            </p>
          )}
        </div>
      )}
      {job.state === "failed" && job.error && <p className="text-xs text-destructive">{job.error}</p>}
    </li>
  );
}
