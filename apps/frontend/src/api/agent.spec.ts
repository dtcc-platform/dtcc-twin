import type { AgentEvent, ChatDetail } from "@repo/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { agentQueries, askQuestion } from "./agent";
import { api } from "./client/api-client";
it("polls a waiting chat and stops when there is no pending change", () => {
  const detail: ChatDetail = {
    id: "019a5184-7bc0-7000-8000-000000000001",
    title: "Chat",
    createdAt: "2026-11-07T12:00:00Z",
    updatedAt: "2026-11-07T12:00:00Z",
    entries: [],
    jobs: [],
    area: null,
    waitingJobs: 0,
    answering: false,
  };
  const client = new QueryClient();
  const options = agentQueries.detail("chat-id");
  const observer = new QueryObserver(client, options);
  const interval = options.refetchInterval;
  if (typeof interval !== "function") throw new Error("Expected conditional polling");
  const query = observer.getCurrentQuery();
  client.setQueryData(options.queryKey, { ...detail, waitingJobs: 1, answering: false });
  expect(interval(query)).toBe(3000);
  client.setQueryData(options.queryKey, { ...detail, waitingJobs: 0, answering: false });
  expect(interval(query)).toBe(false);
  client.setQueryData(options.queryKey, { ...detail, waitingJobs: 0, answering: true });
  expect(interval(query)).toBe(3000);
  client.clear();
});
it("turns an error page that is not JSON into an error event", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ data: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    ),
  );
  const events: AgentEvent[] = [];
  await expect(
    askQuestion(
      "019a5184-7bc0-7000-8000-000000000001",
      { text: "Hello", area: null },
      (event) => events.push(event),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(events).toEqual([{ type: "error", code: "AGENT_UNAVAILABLE", message: "The question could not be sent." }]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
