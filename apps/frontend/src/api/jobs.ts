import type { CreateJobBody, Job } from "@repo/contracts";
import { mutationOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["jobs"] as const;

export const jobQueries = {
  all,
};

export const jobMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateJobBody) => (await api.post<Job>("/jobs", body)).data,
      onSuccess: (_job, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
