import type { ApiKeyList, CreateApiKeyBody, CreatedApiKey } from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";

const all = ["keys"] as const;

export const keyQueries = {
  all,
  list: () =>
    queryOptions({
      queryKey: [...all, "list"],
      queryFn: async ({ signal }) => (await api.get<ApiKeyList>("/keys", { signal })).data,
    }),
  forUser: (userId: string) =>
    queryOptions({
      queryKey: [...all, "user", userId],
      queryFn: async ({ signal }) => (await api.get<ApiKeyList>(`/admin/users/${userId}/keys`, { signal })).data,
    }),
};

export const keyMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async (body: CreateApiKeyBody) => (await api.post<CreatedApiKey>("/keys", body)).data,
      onSuccess: (_key, _body, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  delete: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/keys/${id}`);
      },
      onSuccess: (_data, _id, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  revokeForUser: () =>
    mutationOptions({
      mutationFn: async ({ userId, keyId }: { userId: string; keyId: string }) => {
        await api.delete(`/admin/users/${userId}/keys/${keyId}`);
      },
      onSuccess: (_data, _variables, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
