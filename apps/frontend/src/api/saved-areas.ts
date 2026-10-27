import type { CreateSavedAreaBody, SavedArea, SavedAreaPage, UpdateSavedAreaBody } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["saved-areas"] as const;

export const savedAreaQueries = {
  all,
  /** The user's latest saved areas, newest first. */
  list: (query: { limit: number }) =>
    queryOptions({
      queryKey: [...all, "list", query],
      queryFn: async ({ signal }) => (await api.get<SavedAreaPage>("/saved-areas", { params: query, signal })).data,
    }),
};

export const savedAreaMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateSavedAreaBody) => (await api.post<SavedArea>("/saved-areas", body)).data,
      onSuccess: (_area, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  rename: () =>
    mutationOptions({
      mutationFn: async ({ id, ...body }: UpdateSavedAreaBody & { id: string }) =>
        (await api.patch<SavedArea>(`/saved-areas/${id}`, body)).data,
      onSuccess: (_area, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  delete: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/saved-areas/${id}`);
      },
      onSuccess: (_result, _id, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
