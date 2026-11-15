import type { CreateJobBody, Job, JobArtifactMetadata, JobPage } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["jobs"] as const;
// Outside `all`: a job's artifact never changes, so submitting a job mustn't refetch each one drawn on the map.
const artifacts = ["job-artifacts"] as const;

/** A completed job's files: its whole package, or the extra file in it. */
export type JobFile = "package" | "artifact";

/** Where a completed job's file is, for a link or for the map to load itself. */
export function jobFileUrl(id: string, file: JobFile): string {
  return `${api.defaults.baseURL ?? ""}/jobs/${id}/${file}`;
}

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
  detail: (id: string) =>
    queryOptions({
      queryKey: [...all, "detail", id],
      queryFn: async ({ signal }) => (await api.get<Job>(`/jobs/${id}`, { signal })).data,
      refetchInterval: (current) => jobPollInterval(current.state.data ? [current.state.data] : []),
    }),
  /** A completed job's GeoJSON artifact. */
  geojson: (id: string) =>
    queryOptions({
      queryKey: [...artifacts, "geojson", id],
      queryFn: async ({ signal }) => (await api.get<GeoJSON.GeoJSON>(`/jobs/${id}/artifact`, { signal })).data,
      staleTime: Infinity,
    }),
  /** Where the map places a completed job's artifact, and its legend. */
  artifactMetadata: (id: string) =>
    queryOptions({
      queryKey: [...artifacts, "metadata", id],
      queryFn: async ({ signal }) =>
        (await api.get<JobArtifactMetadata>(`/jobs/${id}/artifact/metadata`, { signal })).data,
      staleTime: Infinity,
    }),
};

export const jobMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateJobBody) => (await api.post<Job>("/jobs", body)).data,
      onSuccess: (_job, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  /** Hands a completed job's package, or its artifact, to the browser's own download, so it never sits in memory. */
  download: () =>
    mutationOptions({
      mutationFn: async ({ id, file }: { id: string; file: JobFile }) => {
        // The link carries only the cookies: asking for the job first refreshes an expired access token.
        await api.get<Job>(`/jobs/${id}`);
        const link = document.createElement("a");
        link.href = jobFileUrl(id, file);
        link.click();
      },
    }),
};
