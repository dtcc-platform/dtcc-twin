import type { Chat, ChatMessageBody, ChatPage } from "@repo/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "./client/api-client.ts";
import { jobQueries } from "./jobs.ts";

const all = ["chats"] as const;

/**
 * Poll a chat while it will change without the user: a turn is running, or a job it started will be reported in it.
 * The backend has no event stream.
 */
export function chatPollInterval(chat: Chat | undefined): number | false {
  return chat && (chat.answering || chat.waitingJobs > 0) ? 3000 : false;
}

export const chatQueries = {
  all,
  /** The user's chats, most recently active first. */
  list: (query: { limit: number }) =>
    queryOptions({
      queryKey: [...all, "list", query],
      queryFn: async ({ signal }) => (await api.get<ChatPage>("/chats", { params: query, signal })).data,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...all, "detail", id],
      queryFn: async ({ signal }) => (await api.get<Chat>(`/chats/${id}`, { signal })).data,
      refetchInterval: (current) => chatPollInterval(current.state.data),
    }),
};

// The response is the whole chat after the turn, and a turn can start jobs.
async function answered(client: QueryClient, chat: Chat): Promise<void> {
  client.setQueryData(chatQueries.detail(chat.id).queryKey, chat);
  await Promise.all([
    client.invalidateQueries({ queryKey: all }),
    client.invalidateQueries({ queryKey: jobQueries.all }),
  ]);
}

export const chatMutations = {
  /** Starts a chat with its first message; resolves once the assistant has answered it. */
  create: () =>
    mutationOptions({
      mutationFn: async (body: ChatMessageBody) => (await api.post<Chat>("/chats", body)).data,
      onSuccess: (chat, _body, _onMutateResult, { client }) => answered(client, chat),
    }),
  /** Sends a message in a chat; resolves once the assistant has answered it. */
  send: () =>
    mutationOptions({
      mutationFn: async ({ id, body }: { id: string; body: ChatMessageBody }) =>
        (await api.post<Chat>(`/chats/${id}/messages`, body)).data,
      onSuccess: (chat, _variables, _onMutateResult, { client }) => answered(client, chat),
    }),
  delete: () =>
    mutationOptions({
      mutationFn: async (id: string) => {
        await api.delete(`/chats/${id}`);
      },
      onSuccess: (_data, _id, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: all }),
    }),
};
