import type { LoginBody, RegisterBody, SessionList, User } from "@repo/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";
import { ApiError } from "./client/api-error.ts";

const all = ["auth"] as const;
const meKey = [...all, "me"] as const;

export const authQueries = {
  all,
  /** The logged-in user, or null when nobody is: a 401 here is an answer, not an error. */
  me: () =>
    queryOptions({
      queryKey: meKey,
      queryFn: async ({ signal }): Promise<User | null> => {
        try {
          const response = await api.get<User>("/auth/me", { signal });
          return response.data;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return null;
          throw error;
        }
      },
    }),
  sessions: () =>
    queryOptions({
      queryKey: [...all, "sessions"],
      queryFn: async ({ signal }) => (await api.get<SessionList>("/auth/sessions", { signal })).data,
    }),
};

export const authMutations = {
  login: () =>
    mutationOptions({
      mutationFn: async (body: LoginBody) => (await api.post<User>("/auth/login", body)).data,
      onSuccess: (user, _body, _onMutateResult, { client }) => {
        rememberUser(client, user);
      },
    }),
  register: () =>
    mutationOptions({
      mutationFn: async (body: RegisterBody) => (await api.post<User>("/auth/register", body)).data,
      onSuccess: (user, _body, _onMutateResult, { client }) => {
        rememberUser(client, user);
      },
    }),
  logout: () =>
    mutationOptions({
      mutationFn: async () => {
        await api.post("/auth/logout");
      },
      onSuccess: (_data, _variables, _onMutateResult, { client }) => {
        forgetUser(client);
      },
    }),
  logoutEverywhere: () =>
    mutationOptions({
      mutationFn: async () => {
        await api.post("/auth/logout-all");
      },
      onSuccess: (_data, _variables, _onMutateResult, { client }) => {
        forgetUser(client);
      },
    }),
  revokeSession: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/auth/sessions/${id}`);
      },
      onSuccess: (_data, _id, _onMutateResult, { client }) =>
        client.invalidateQueries({ queryKey: [...all, "sessions"] }),
    }),
};

/**
 * Marks nobody as logged in; the route guards take it from there. Cached data stays: removing a query
 * a mounted page still uses would make it refetch, answer 401, and land back here.
 */
export function forgetUser(client: QueryClient): void {
  client.setQueryData(meKey, null);
}

// Drops every cached response first, so nothing the previous user saw can show.
function rememberUser(client: QueryClient, user: User): void {
  client.removeQueries({ predicate: (query) => query.queryKey[1] !== "me" });
  client.setQueryData(meKey, user);
}
