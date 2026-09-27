import type { DatasetPage } from "@repo/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["datasets"] as const;

export const datasetQueries = {
  all,
  // The catalogue is small (under 30 Datasets); one page of the maximum size holds it all.
  list: () =>
    queryOptions({
      queryKey: [...all, "list"],
      queryFn: async ({ signal }) => (await api.get<DatasetPage>("/datasets", { params: { limit: 100 }, signal })).data,
    }),
};
