import type { Bounds, ChatEntry, ChatMessageBody, Job, JobState } from "@repo/contracts";
import { CircleAlertIcon, InfoIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { formatSquareMetres } from "@/features/area/area";
import { JobItem } from "@/features/jobs/job-item";

type TranscriptProps = {
  entries: ChatEntry[];
  /** The chat's jobs, for the cards of the entries that started them. */
  jobs: Job[];
  titles: Map<string, string>;
  /** The message on its way, until the answer brings it back stored. */
  sending: ChatMessageBody | undefined;
  answering: boolean;
  waitingJobs: number;
};

const endings: Record<Exclude<JobState, "queued" | "running">, string> = {
  completed: "finished",
  failed: "failed",
  cancelled: "was cancelled",
};

/** The conversation as it happened: the user's words, the assistant's answers, and the jobs it ran. */
export function Transcript({ entries, jobs, titles, sending, answering, waitingJobs }: TranscriptProps) {
  const end = useRef<HTMLDivElement>(null);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  // Keeps the newest entry in view as entries arrive: the scroll position belongs to the DOM, not to React.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length, sending, answering]);

  if (entries.length === 0 && !sending) {
    return (
      <p className="pb-3 text-sm text-muted-foreground">
        Draw an area on the map and ask about it, such as &ldquo;How many trees are in this area?&rdquo;. The assistant
        runs Datasets as jobs and posts their results here when they finish, even after you close the panel.
      </p>
    );
  }

  return (
    <>
      <ol className="flex flex-col gap-3 pb-3" aria-label="Conversation">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Entry entry={entry} job={entry.type === "job" ? jobsById.get(entry.jobId) : undefined} titles={titles} />
          </li>
        ))}
        {sending && (
          <li>
            <UserWords text={sending.text} bounds={sending.bounds} />
          </li>
        )}
        {answering && (
          <li className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Answering…
          </li>
        )}
        {!answering && waitingJobs > 0 && (
          <li className="text-xs text-muted-foreground">
            Waiting for {waitingJobs === 1 ? "a job" : `${String(waitingJobs)} jobs`}; the answer will appear here.
          </li>
        )}
      </ol>
      <div ref={end} />
    </>
  );
}

function Entry({ entry, job, titles }: { entry: ChatEntry; job: Job | undefined; titles: Map<string, string> }) {
  switch (entry.type) {
    case "user":
      return <UserWords text={entry.text} bounds={entry.bounds} />;
    case "assistant":
      return <p className="mr-6 text-sm whitespace-pre-wrap">{entry.text}</p>;
    case "job": {
      const title = titles.get(entry.dataset) ?? entry.dataset;
      if (!job) return <p className="text-xs text-muted-foreground">Started {title}</p>;
      return (
        <ul>
          <JobItem job={job} title={title} />
        </ul>
      );
    }
    case "job_update":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="size-3.5 shrink-0" />
          {titles.get(entry.dataset) ?? entry.dataset}{" "}
          {entry.state === "queued" || entry.state === "running" ? "is running" : endings[entry.state]}
        </p>
      );
    case "notice":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleAlertIcon className="size-3.5 shrink-0" />
          {entry.text}
        </p>
      );
  }
}

function UserWords({ text, bounds }: { text: string; bounds: Bounds | null }) {
  return (
    <div className="ml-6 flex flex-col items-end gap-1">
      <p className="rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </p>
      {bounds && (
        <span className="text-xs text-muted-foreground">Area: {formatSquareMetres(squareMetres(bounds))}</span>
      )}
    </div>
  );
}

function squareMetres([minX, minY, maxX, maxY]: Bounds): number {
  return (maxX - minX) * (maxY - minY);
}
