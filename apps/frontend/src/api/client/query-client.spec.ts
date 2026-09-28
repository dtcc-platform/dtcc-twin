import type { User } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { authQueries } from "../auth.ts";
import { queryClient, shouldRetry } from "./query-client.ts";

const serverError = new ApiError(503, undefined);

describe("shouldRetry", () => {
  it("retries network and server errors up to three times", () => {
    expect(shouldRetry(0, new TypeError("Network Error"))).toBe(true);
    expect(shouldRetry(2, serverError)).toBe(true);
    expect(shouldRetry(3, serverError)).toBe(false);
  });

  it("does not retry client errors", () => {
    expect(shouldRetry(0, new ApiError(404, undefined))).toBe(false);
  });
});

describe("queryClient", () => {
  const me = authQueries.me().queryKey;
  const ada: User = {
    id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
    email: "ada@example.com",
    name: "Ada",
    role: "user",
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
  };

  function failQuery(error: Error) {
    return queryClient
      .query({ queryKey: ["items"], queryFn: () => Promise.reject(error), retry: false })
      .catch(() => undefined);
  }

  it("forgets the logged-in user when a query answers 401, which means the refresh failed too", async () => {
    queryClient.setQueryData(me, ada);

    await failQuery(new ApiError(401, undefined));

    expect(queryClient.getQueryData(me)).toBeNull();
  });

  it("keeps the user through other errors", async () => {
    queryClient.setQueryData(me, ada);

    await failQuery(new ApiError(500, undefined));

    expect(queryClient.getQueryData(me)).toEqual(ada);
  });
});
