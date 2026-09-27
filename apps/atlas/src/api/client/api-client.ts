import axios, { type CreateAxiosDefaults, isAxiosError } from "axios";
import { ApiError } from "./api-error.ts";
import { canRefreshAfter, refreshPath, sharedRefresh } from "./session-refresh.ts";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Set on the one retry after a refresh, so a second 401 gives up instead of refreshing again. */
    retriedAfterRefresh?: boolean;
  }
}

export function createApiClient(config: CreateAxiosDefaults = {}) {
  const client = axios.create({
    // dev server proxies /api to the backend in vite config
    baseURL: import.meta.env.VITE_API_URL ?? "/api",
    withCredentials: true,
    // repeated keys to arrays rather than using the brackets notation
    paramsSerializer: { indexes: null },
    ...config,
  });

  const refresh = sharedRefresh(() => client.post(refreshPath));

  client.interceptors.response.use(undefined, async (error: unknown) => {
    if (!isAxiosError(error) || !error.response) throw error;

    // The access token is short-lived; the refresh cookie renews it, then the request runs again.
    const request = error.config;
    const expired = error.response.status === 401 && request !== undefined && !request.retriedAfterRefresh;
    if (expired && canRefreshAfter(request.url ?? "")) {
      const refreshed = await refresh();
      if (refreshed) return client.request({ ...request, retriedAfterRefresh: true });
    }

    throw new ApiError(error.response.status, error.response.data, { cause: error });
  });

  return client;
}

export const api = createApiClient();
