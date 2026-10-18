import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { authQueries } from "@/api/auth";
import { datasetQueries } from "@/api/datasets";
import { jobQueries } from "@/api/jobs";
import { FloatingCard } from "@/components/common/floating-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { JobItem } from "./job-item.tsx";

const pageSize = 20;
// The backend's largest page.
const maxJobs = 100;

/** The user's jobs, newest first, with their progress and packages. */
export function DownloadsPanel({ onClose }: { onClose: () => void }) {
  const me = useQuery(authQueries.me());

  return (
    <FloatingCard title="Downloads" onClose={onClose}>
      {me.isPending && <Spinner className="mx-auto my-4" />}
      {me.data === null && (
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted-foreground">Log in to see your jobs and download their packages.</p>
          <Link to="/" search={{ auth: "login" }} className={buttonVariants({ size: "sm" })}>
            Log in
          </Link>
        </div>
      )}
      {me.data && <JobList />}
    </FloatingCard>
  );
}

function JobList() {
  const [limit, setLimit] = useState(pageSize);
  const jobs = useQuery({ ...jobQueries.list({ limit }), placeholderData: keepPreviousData });
  // Titles read better than names; a Dataset the engine no longer has keeps its name.
  const datasets = useQuery(datasetQueries.list());
  const titles = new Map(datasets.data?.items.map((dataset) => [dataset.name, dataset.title]));

  if (jobs.isPending) return <Spinner className="mx-auto my-4" />;
  if (jobs.isError) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="text-destructive">{jobs.error.message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void jobs.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const { items, total } = jobs.data;
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs yet. Run a Dataset on an area, and its package shows up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {items.map((job) => (
          <JobItem key={job.id} job={job} title={titles.get(job.dataset) ?? job.dataset} />
        ))}
      </ul>
      {total > items.length && limit < maxJobs && (
        <Button
          variant="ghost"
          size="sm"
          disabled={jobs.isPlaceholderData}
          onClick={() => {
            setLimit(Math.min(limit + pageSize, maxJobs));
          }}
        >
          Show more
        </Button>
      )}
      {total > items.length && limit >= maxJobs && (
        <p className="text-center text-xs text-muted-foreground">Showing your latest {maxJobs} jobs</p>
      )}
    </div>
  );
}
