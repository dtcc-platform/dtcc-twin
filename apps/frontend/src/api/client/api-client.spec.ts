import { isAxiosError } from "axios";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client.ts";
import { ApiError } from "./api-error.ts";

const errorBody = { status: 404, code: "NOT_FOUND", message: "Example not found", requestId: "request-1" };
const errorResponse = { error: errorBody };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Runs axios through its fetch adapter with a stubbed fetch. Browsers use the XHR adapter; what these
// tests cover (base URL, credentials, parameter encoding, error handling) is the same for both.
function clientAnswering(result: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const client = createApiClient({ baseURL: "http://api.test/api", adapter: "fetch", env: { fetch } });
  return { client, fetch };
}

// axios calls fetch either as fetch(request) or as fetch(url, init); a Request built from the arguments covers both.
function sentRequest(fetch: ReturnType<typeof clientAnswering>["fetch"]): Request {
  const [input, init] = fetch.mock.calls[0] ?? [];
  if (input === undefined) throw new Error("fetch was not called");
  return new Request(input, init);
}

describe("createApiClient", () => {
  it("sends requests below the base URL with credentials", async () => {
    const { client, fetch } = clientAnswering(jsonResponse(200, {}));

    await client.get("/items");

    const request = sentRequest(fetch);
    expect(request.url).toBe("http://api.test/api/items");
    expect(request.credentials).toBe("include");
  });

  it("encodes array params as repeated keys and skips undefined ones", async () => {
    const { client, fetch } = clientAnswering(jsonResponse(200, {}));

    await client.get("/items", { params: { ids: ["a", "b"], limit: 5, offset: undefined } });

    expect(sentRequest(fetch).url).toBe("http://api.test/api/items?ids=a&ids=b&limit=5");
  });

  it("resolves with the parsed JSON body", async () => {
    const { client } = clientAnswering(jsonResponse(200, { items: [] }));

    const response = await client.get("/items");

    expect(response.data).toEqual({ items: [] });
  });

  it("rejects an error response with an ApiError carrying the error body", async () => {
    const { client } = clientAnswering(jsonResponse(404, errorResponse));

    const error = await client.get("/items/1").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, body: errorBody, message: "Example not found" });
  });

  it("ignores an error body that is not wrapped in the envelope", async () => {
    const { client } = clientAnswering(jsonResponse(404, errorBody));

    const error = await client.get("/items/1").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 404, body: undefined });
  });

  it("leaves body undefined when the response is not one of ours", async () => {
    const { client } = clientAnswering(
      new Response("<h1>Bad gateway</h1>", { status: 502, headers: { "Content-Type": "text/html" } }),
    );

    const error = await client.get("/items").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, body: undefined, message: "Request failed with status 502" });
  });

  it("passes errors without a response through unchanged", async () => {
    const { client } = clientAnswering(new TypeError("fetch failed"));

    const error = await client.get("/items").catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(ApiError);
    expect(isAxiosError(error) && error.code).toBe("ERR_NETWORK");
  });
});

const unauthorized = () =>
  jsonResponse(401, { error: { status: 401, code: "UNAUTHORIZED", message: "Unauthorized", requestId: "r" } });
const ok = (body: unknown = {}) => jsonResponse(200, body);
const noContent = () => new Response(null, { status: 204 });

// Read from the URL alone: rebuilding a Request whose body was sent throws.
function pathOf(input: RequestInfo | URL): string {
  return new URL(input instanceof Request ? input.url : input).pathname;
}

// Answers each request with the next response queued for its path, so a test lays out a whole exchange.
function clientRouting(routes: Record<string, Response[]>) {
  const fetch = vi.fn<typeof globalThis.fetch>((input) => {
    const path = pathOf(input);
    const response = routes[path]?.shift();
    return response ? Promise.resolve(response) : Promise.reject(new Error(`No response queued for ${path}`));
  });
  const client = createApiClient({ baseURL: "http://api.test/api", adapter: "fetch", env: { fetch } });
  const calls = () => fetch.mock.calls.map(([input]) => pathOf(input));
  return { client, calls };
}

describe("createApiClient session refresh", () => {
  it("refreshes the session after a 401 and retries the request once", async () => {
    const { client, calls } = clientRouting({
      "/api/items": [unauthorized(), ok({ items: [] })],
      "/api/auth/refresh": [noContent()],
    });

    const response = await client.get("/items");

    expect(response.data).toEqual({ items: [] });
    expect(calls()).toEqual(["/api/items", "/api/auth/refresh", "/api/items"]);
  });

  it("shares one refresh between requests that fail together", async () => {
    const { client, calls } = clientRouting({
      "/api/items": [unauthorized(), ok()],
      "/api/settings": [unauthorized(), ok()],
      "/api/auth/refresh": [noContent()],
    });

    await Promise.all([client.get("/items"), client.get("/settings")]);

    expect(calls().filter((path) => path === "/api/auth/refresh")).toHaveLength(1);
  });

  it("rejects with the request's own 401 when the refresh fails", async () => {
    const { client } = clientRouting({ "/api/items": [unauthorized()], "/api/auth/refresh": [unauthorized()] });

    const error = await client.get("/items").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401 });
  });

  it("gives up when the retried request answers 401 again", async () => {
    const { client, calls } = clientRouting({
      "/api/items": [unauthorized(), unauthorized()],
      "/api/auth/refresh": [noContent()],
    });

    await expect(client.get("/items")).rejects.toMatchObject({ status: 401 });
    expect(calls()).toHaveLength(3);
  });

  it("does not refresh after a 401 from the auth routes, which a refresh cannot fix", async () => {
    const { client, calls } = clientRouting({ "/api/auth/login": [unauthorized()] });

    await expect(client.post("/auth/login", {})).rejects.toMatchObject({ status: 401 });
    expect(calls()).toEqual(["/api/auth/login"]);
  });
});
