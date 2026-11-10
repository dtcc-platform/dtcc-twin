import { zodResolver } from "@hookform/resolvers/zod";
import { updateChatBodySchema, type Chat } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { agentMutations, agentQueries } from "@/api/agent";
import { ConfirmButton } from "@/components/common/confirm-button";
import { TextField } from "@/components/common/text-field";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { showSubmitError } from "@/lib/show-submit-error";

export function ChatList({ onOpen }: { onOpen: (id: string) => void }) {
  const [limit, setLimit] = useState(20);
  const chats = useQuery(agentQueries.list({ limit }));
  const create = useMutation(agentMutations.create());
  return (
    <div className="flex flex-col gap-3">
      <Button
        disabled={create.isPending}
        onClick={() => {
          create.mutate(undefined, {
            onSuccess: (chat) => {
              onOpen(chat.id);
            },
            onError: (error) => toast.error(error.message),
          });
        }}
      >
        New chat
      </Button>
      {chats.isPending && <Spinner className="mx-auto" />}
      {chats.isError && (
        <p role="alert" className="text-sm text-destructive">
          {chats.error.message}
        </p>
      )}
      {chats.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No chats yet. Start a chat about your drawn area.</p>
      )}
      <ul className="flex flex-col gap-2">
        {chats.data?.items.map((chat) => (
          <ChatRow key={chat.id} chat={chat} onOpen={onOpen} />
        ))}
      </ul>
      {chats.data && chats.data.total > chats.data.items.length && limit < 100 && (
        <Button
          variant="ghost"
          onClick={() => {
            setLimit(Math.min(limit + 20, 100));
          }}
        >
          Show more
        </Button>
      )}
    </div>
  );
}
function ChatRow({ chat, onOpen }: { chat: Chat; onOpen: (id: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const remove = useMutation(agentMutations.delete());
  const rename = useMutation(agentMutations.rename());
  const form = useForm({ resolver: zodResolver(updateChatBodySchema), defaultValues: { title: chat.title } });
  if (renaming)
    return (
      <li>
        <form
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(event) =>
            void form.handleSubmit((body) => {
              rename.mutate(
                { id: chat.id, ...body },
                {
                  onSuccess: () => {
                    setRenaming(false);
                  },
                  onError: (error) => showSubmitError(form.setError, error),
                },
              );
            })(event)
          }
        >
          <TextField control={form.control} name="title" label="Chat title" id={`chat-title-${chat.id}`} />
          {form.formState.errors.root?.message && <p role="alert">{form.formState.errors.root.message}</p>}
          <Button type="submit" disabled={rename.isPending}>
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRenaming(false);
            }}
          >
            Cancel
          </Button>
        </form>
      </li>
    );
  return (
    <li className="flex flex-wrap items-center gap-1 rounded-xl border p-2">
      <button
        type="button"
        className="w-full truncate rounded px-1 py-2 text-left text-sm font-medium hover:bg-muted focus-visible:ring-2"
        onClick={() => {
          onOpen(chat.id);
        }}
      >
        {chat.title}
      </button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setRenaming(true);
        }}
      >
        Rename
      </Button>
      <ConfirmButton
        label="Delete"
        variant="ghost"
        title={`Delete ${chat.title}?`}
        description="The chat and its messages are removed. Its jobs stay in Downloads."
        disabled={remove.isPending}
        onConfirm={() => {
          remove.mutate(chat.id, { onError: (error) => toast.error(error.message) });
        }}
      />
    </li>
  );
}
