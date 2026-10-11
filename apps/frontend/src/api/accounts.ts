import type { CreateUserBody, OffsetPaginationQuery, UpdateUserBody, User, UserPage } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["accounts"] as const;

export const accountQueries = {
  all,
  list: (query: Partial<OffsetPaginationQuery> = {}) =>
    queryOptions({
      queryKey: [...all, "list", query],
      queryFn: async ({ signal }) => (await api.get<UserPage>("/admin/users", { params: query, signal })).data,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...all, "detail", id],
      queryFn: async ({ signal }) => (await api.get<User>(`/admin/users/${id}`, { signal })).data,
    }),
};

export const accountMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateUserBody) => (await api.post<User>("/admin/users", body)).data,
      onSuccess: (_user, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  update: () =>
    mutationOptions({
      mutationFn: async ({ id, body }: { id: string; body: UpdateUserBody }) =>
        (await api.patch<User>(`/admin/users/${id}`, body)).data,
      onSuccess: (_user, _variables, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  delete: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/admin/users/${id}`);
      },
      // The user's settings and items go with them.
      onSuccess: (_data, _id, _onMutateResult, { client }) => client.invalidateQueries(),
    }),
};
