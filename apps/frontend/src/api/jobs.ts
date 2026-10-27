import type { CreateJobBody, Job, JobPage } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["jobs"] as const;

/** A job still waiting or running, whose state the backend refreshes from the engine on every read. */
export function isActiveJob(job: Job): boolean {
  return job.state === "queued" || job.state === "running";
}

/** Poll while a job is active: the backend has no event stream, and stops polling once every job has finished. */
export function jobPollInterval(jobs: Job[]): number | false {
  return jobs.some(isActiveJob) ? 3000 : false;
}

export const jobQueries = {
  all,
  /** The user's latest jobs, newest first. */
  list: (query: { limit: number }) =>
    queryOptions({
      queryKey: [...all, "list", query],
      queryFn: async ({ signal }) => (await api.get<JobPage>("/jobs", { params: query, signal })).data,
      refetchInterval: (current) => jobPollInterval(current.state.data?.items ?? []),
    }),
};

export const jobMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateJobBody) => (await api.post<Job>("/jobs", body)).data,
      onSuccess: (_job, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  /** Hands a completed job's package to the browser's own download, so it never sits in memory. */
  download: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        // The link carries only the cookies: asking for the job first refreshes an expired access token.
        await api.get<Job>(`/jobs/${id}`);
        const link = document.createElement("a");
        link.href = `${api.defaults.baseURL ?? ""}/jobs/${id}/package`;
        link.click();
      },
    }),
};
