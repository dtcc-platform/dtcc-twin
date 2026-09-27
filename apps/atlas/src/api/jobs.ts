import type { CreateJobBody, Job, JobPage, JobResult } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["jobs"] as const;

export const jobQueries = {
  all,
  // Newest first. Each read also brings the jobs up to date with the engine, so polling is what moves them along.
  list: () =>
    queryOptions({
      queryKey: [...all, "list"],
      queryFn: async ({ signal }) => (await api.get<JobPage>("/jobs", { params: { limit: 100 }, signal })).data,
      refetchInterval: (query) => jobsRefetchInterval(query.state.data),
    }),
  // A completed job's result and files never change, so they're fetched once.
  result: (id: string) =>
    queryOptions({
      queryKey: [...all, "result", id],
      queryFn: async ({ signal }) => (await api.get<JobResult>(`/jobs/${id}/result`, { signal })).data,
      staleTime: Infinity,
    }),
  geojsonArtifact: (id: string, file: string) =>
    queryOptions({
      queryKey: [...all, "artifact", id, file],
      queryFn: async ({ signal }) =>
        (await api.get<GeoJSON.FeatureCollection>(`/jobs/${id}/artifacts/${file}`, { signal, responseType: "json" }))
          .data,
      staleTime: Infinity,
    }),
};

/** Where the browser downloads a completed job's `.dtccpkg`, with the API's cookies. */
export function jobPackageUrl(id: string): string {
  return `${api.defaults.baseURL ?? ""}/jobs/${id}/package`;
}

/** Poll every second while any job is unfinished, and not at all otherwise. */
export function jobsRefetchInterval(page: JobPage | undefined): number | false {
  const unfinished = page?.items.some((job) => job.state === "queued" || job.state === "running") ?? false;
  return unfinished ? 1000 : false;
}

export const jobMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateJobBody) => (await api.post<Job>("/jobs", body)).data,
      onSuccess: (_job, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
