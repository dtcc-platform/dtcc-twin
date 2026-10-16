import type { HealthStatus } from "@repo/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["health"] as const;

export const healthQueries = {
  all,
  ready: () =>
    queryOptions({
      queryKey: [...all, "ready"],
      queryFn: async ({ signal }) => (await api.get<HealthStatus>("/health/ready", { signal })).data,
      refetchInterval: 30_000,
      retry: false,
    }),
};
