import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-error.ts";
import { forgetUser } from "../auth.ts";

// only retry network and server errors, not client errors (4xx)
export function shouldRetry(failureCount: number, error: Error): boolean {
  return failureCount < 3 && !(error instanceof ApiError && error.status < 500);
}

export const queryClient: QueryClient = new QueryClient({
  // A 401 here means the automatic refresh failed too: the session has ended.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) forgetUser(queryClient);
    },
  }),
  defaultOptions: { queries: { retry: shouldRetry } },
});
