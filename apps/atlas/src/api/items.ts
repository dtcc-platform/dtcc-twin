import type { CreateItemBody, Item, ItemPage, OffsetPaginationQuery, UpdateItemBody } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["items"] as const;

export const itemQueries = {
  all,
  list: (query: Partial<OffsetPaginationQuery> = {}) =>
    queryOptions({
      queryKey: [...all, "list", query],
      queryFn: async ({ signal }) => (await api.get<ItemPage>("/items", { params: query, signal })).data,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...all, "detail", id],
      queryFn: async ({ signal }) => (await api.get<Item>(`/items/${id}`, { signal })).data,
    }),
};

export const itemMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateItemBody) => (await api.post<Item>("/items", body)).data,
      onSuccess: (_item, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  update: () =>
    mutationOptions({
      mutationFn: async ({ id, body }: { id: string; body: UpdateItemBody }) =>
        (await api.patch<Item>(`/items/${id}`, body)).data,
      onSuccess: (_item, _variables, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  delete: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/items/${id}`);
      },
      onSuccess: (_data, _id, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
