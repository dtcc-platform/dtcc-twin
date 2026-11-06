import type { ChatSummary } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { chatMutations, chatQueries } from "@/api/chats";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/relative-time";

// The backend's largest page; more chats than this is not a case to design for yet.
const limit = 100;

/** The user's chats, most recently active first, and a way to start another. */
export function ChatList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const chats = useQuery(chatQueries.list({ limit }));

  return (
    <div className="flex flex-col gap-3">
      <Button size="sm" className="self-start" onClick={onNew}>
        <PlusIcon />
        New chat
      </Button>
      {chats.isPending && <Spinner className="mx-auto my-4" />}
      {chats.isError && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-destructive">{chats.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void chats.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {chats.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No chats yet. Draw an area, start a chat and ask about it, such as how many trees it has.
        </p>
      )}
      {chats.data && chats.data.items.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {chats.data.items.map((chat) => (
            <ChatItem key={chat.id} chat={chat} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatItem({ chat, onOpen }: { chat: ChatSummary; onOpen: (id: string) => void }) {
  const remove = useMutation(chatMutations.delete());

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => {
          onOpen(chat.id);
        }}
      >
        <span className="block truncate text-sm font-medium">{chat.title}</span>
        <span className="text-xs text-muted-foreground">{formatRelativeTime(chat.updatedAt)}</span>
      </button>
      <ConfirmButton
        label="Delete"
        variant="ghost"
        title={`Delete ${chat.title}?`}
        description="The conversation is removed for good. The jobs it started stay in your Downloads."
        disabled={remove.isPending}
        onConfirm={() => {
          remove.mutate(chat.id, { onError: (error) => toast.error(error.message) });
        }}
      />
    </li>
  );
}
