import type { ChatMessageBody } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { chatMutations, chatQueries } from "@/api/chats";
import { datasetQueries } from "@/api/datasets";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Composer } from "./composer/composer.tsx";
import { Transcript } from "./transcript/transcript.tsx";

type ConversationProps = {
  /** The stored chat, or null for a new one that its first message starts. */
  chatId: string | null;
  onStarted: (id: string) => void;
};

/** One chat: what was said and done in it, and the box to say more. */
export function Conversation({ chatId, onStarted }: ConversationProps) {
  const chat = useQuery({ ...chatQueries.detail(chatId ?? ""), enabled: chatId !== null });
  const create = useMutation(chatMutations.create());
  const send = useMutation(chatMutations.send());
  // Titles read better than names; a Dataset the engine no longer has keeps its name.
  const datasets = useQuery(datasetQueries.list());
  const titles = new Map(datasets.data?.items.map((dataset) => [dataset.name, dataset.title]));

  // Shown until the answer comes back with it: the turn runs within the request.
  const mutation =
    chatId === null
      ? { pending: create.isPending, body: create.variables }
      : { pending: send.isPending, body: send.variables?.body };
  const sending = mutation.pending ? mutation.body : undefined;

  function submit(body: ChatMessageBody, onError: (error: Error) => void) {
    if (chatId === null) {
      create.mutate(body, { onSuccess: (created) => onStarted(created.id), onError });
    } else {
      send.mutate({ id: chatId, body }, { onError });
    }
  }

  if (chatId !== null && chat.isPending) return <Spinner className="mx-auto my-4" />;
  if (chat.isError) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="text-destructive">{chat.error.message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void chat.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const answering = sending !== undefined || (chat.data?.answering ?? false);
  return (
    <div className="flex flex-col">
      <Transcript
        entries={chat.data?.entries ?? []}
        jobs={chat.data?.jobs ?? []}
        titles={titles}
        sending={sending}
        answering={answering}
        waitingJobs={chat.data?.waitingJobs ?? 0}
      />
      <Composer disabled={answering} onSend={submit} />
    </div>
  );
}
