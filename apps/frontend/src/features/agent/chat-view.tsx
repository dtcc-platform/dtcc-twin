import type { AgentEvent } from "@repo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { agentQueries, askQuestion } from "@/api/agent";
import { jobQueries } from "@/api/jobs";
import { Spinner } from "@/components/ui/spinner";
import { useAreaStore } from "@/features/area/area-store";
import { JobItem } from "@/features/jobs/job-item";
import { Composer } from "./composer";

export function ChatView({ id, active }: { id: string; active: boolean }) {
  const chat = useQuery(agentQueries.detail(id));
  const area = useAreaStore((state) => state.area);
  const client = useQueryClient();
  const [startEntry, setStartEntry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const [stream, setStream] = useState({
    running: false,
    text: "",
    status: "",
    jobs: [] as { jobId: string; dataset: string }[],
  });
  // Closing or changing the chat cancels its model request; Engine jobs continue.
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  async function send(text: string) {
    setStartEntry(chat.data?.entries.length ?? 0);
    const abort = new AbortController();
    controller.current = abort;
    const errors: string[] = [];
    setStream({ running: true, text: "", status: "Thinking…", jobs: [] });
    try {
      await askQuestion(
        id,
        { text, area },
        (event: AgentEvent) => {
          switch (event.type) {
            case "text":
              setStream((current) => ({ ...current, text: current.text + event.delta }));
              break;
            case "status":
              setStream((current) => ({ ...current, status: event.message }));
              break;
            case "job":
              void client.invalidateQueries({ queryKey: agentQueries.detail(id).queryKey });
              setStream((current) => ({ ...current, jobs: [...current.jobs, event] }));
              break;
            case "error":
              errors.push(event.message);
              break;
            case "done":
              break;
          }
        },
        abort.signal,
      );
      const failure = errors[0];
      if (failure) throw new Error(failure);
    } finally {
      try {
        await Promise.all([
          client.invalidateQueries({ queryKey: agentQueries.all }),
          client.invalidateQueries({ queryKey: jobQueries.all }),
        ]);
      } finally {
        setStream({ running: false, text: "", status: "", jobs: [] });
        controller.current = null;
      }
    }
  }
  if (chat.isPending) return <Spinner className="mx-auto" />;
  if (chat.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {chat.error.message}
      </p>
    );
  const storedText = chat.data.entries
    .slice(startEntry)
    .flatMap((entry) => (entry.type === "assistant" ? entry.text : []))
    .join("");
  const liveText = stream.text.startsWith(storedText) ? stream.text.slice(storedText.length) : stream.text;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">{chat.data.title}</h3>
      <div aria-label="Chat transcript" className="flex flex-col gap-3">
        {chat.data.entries.map((entry, index) => {
          const key = `${entry.id}:${String(index)}`;
          if (entry.type === "job") {
            const job = chat.data.jobs.find((j) => j.id === entry.jobId);
            return job ? (
              <ul key={key}>
                <JobItem job={job} title={entry.dataset} />
              </ul>
            ) : null;
          }
          if (entry.type === "job_update")
            return (
              <p key={key} className="text-xs text-muted-foreground">
                Result posted · {entry.dataset} · {entry.state}
              </p>
            );
          return (
            <div
              key={key}
              className={entry.type === "user" ? "rounded-xl bg-muted p-3" : "whitespace-pre-wrap break-words"}
            >
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {entry.type === "user" ? "You" : entry.type === "assistant" ? "DTCC Twin" : "Notice"}
              </span>
              {entry.text}
            </div>
          );
        })}
        {stream.running && (
          <div aria-live="polite" className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{stream.status}</p>
            {stream.jobs
              .filter((job) => !chat.data.jobs.some((j) => j.id === job.jobId))
              .map((job) => (
                <p key={job.jobId}>Job started · {job.dataset}</p>
              ))}
            <p className="whitespace-pre-wrap break-words">{liveText}</p>
          </div>
        )}
        {chat.data.waitingJobs > 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            Waiting for {chat.data.waitingJobs} job result(s). Results appear here automatically.
          </p>
        )}
      </div>
      {!active && <p className="text-muted-foreground">Your account must be active to ask questions.</p>}
      <Composer area={area} answering={!active || stream.running || chat.data.answering} onSend={send} />
    </div>
  );
}
