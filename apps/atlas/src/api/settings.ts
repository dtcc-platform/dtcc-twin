import type { Settings, UpdateSettingsBody } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["settings"] as const;

export const settingsQueries = {
  all,
  // The logged-in user's own settings.
  detail: () =>
    queryOptions({
      queryKey: [...all, "detail"],
      queryFn: async ({ signal }) => (await api.get<Settings>("/settings", { signal })).data,
    }),
};

export const settingsMutations = {
  update: () =>
    mutationOptions({
      mutationFn: async (body: UpdateSettingsBody) => (await api.patch<Settings>("/settings", body)).data,
      onSuccess: (_settings, _variables, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
