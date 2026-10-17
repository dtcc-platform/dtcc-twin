import type { DatasetList } from "@repo/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["datasets"] as const;

export const datasetQueries = {
  all,
  // Each Dataset carries its argsSchema, so the form needs no request of its own.
  list: () =>
    queryOptions({
      queryKey: [...all, "list"],
      queryFn: async ({ signal }) => (await api.get<DatasetList>("/datasets", { signal })).data,
      // maybe infinite
      staleTime: 10 * 60_000,
    }),
};
