import {
  agentEventSchema,
  errorResponseSchema,
  type AgentEvent,
  type AskBody,
  type Chat,
  type ChatDetail,
  type ChatPage,
  type UpdateChatBody,
} from "@repo/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./client/api-client";
import { parseEventStream } from "./client/event-stream";

const all = ["agent"] as const;
export const agentQueries = {
  all,
  list: (query: { limit: number }) =>
    queryOptions({
      queryKey: [...all, "list", query],
      queryFn: async ({ signal }) => (await api.get<ChatPage>("/agent/chats", { params: query, signal })).data,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...all, "detail", id],
      queryFn: async ({ signal }) => (await api.get<ChatDetail>(`/agent/chats/${id}`, { signal })).data,
      refetchInterval: (current) =>
        current.state.data?.answering || (current.state.data?.waitingJobs ?? 0) > 0 ? 3000 : false,
    }),
};
export const agentMutations = {
  create: () =>
    mutationOptions({
      mutationFn: async () => (await api.post<Chat>("/agent/chats")).data,
      onSuccess: (_data, _body, _context, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  rename: () =>
    mutationOptions({
      mutationFn: async ({ id, ...body }: UpdateChatBody & { id: string }) =>
        (await api.patch<Chat>(`/agent/chats/${id}`, body)).data,
      onSuccess: (_data, _body, _context, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
  delete: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/agent/chats/${id}`);
      },
      onSuccess: (_data, _body, _context, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
export async function askQuestion(
  chatId: string,
  body: AskBody,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  await api.get<ChatDetail>(`/agent/chats/${chatId}`, { signal });
  const response = await fetch(`${api.defaults.baseURL ?? "/api"}/agent/chats/${chatId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    // A proxy in front of the API can answer with an HTML page instead of an error body.
    const error = errorResponseSchema.safeParse(await response.json().catch(() => null));
    const event: AgentEvent = {
      type: "error",
      code: error.success ? error.data.error.code : "AGENT_UNAVAILABLE",
      message: error.success ? error.data.error.message : "The question could not be sent.",
    };
    onEvent(event);
    throw new Error(event.message);
  }
  if (!response.body) throw new Error("The response has no event stream.");
  for await (const event of parseEventStream(decode(response.body), agentEventSchema)) onEvent(event);
}
async function* decode(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        const tail = decoder.decode();
        if (tail) yield tail;
        break;
      }
      yield decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
