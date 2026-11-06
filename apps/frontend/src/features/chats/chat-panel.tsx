import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { authQueries } from "@/api/auth";
import { chatQueries } from "@/api/chats";
import { FloatingCard } from "@/components/common/floating-card";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ChatList } from "./chat-list/chat-list.tsx";
import { Conversation } from "./conversation/conversation.tsx";

// What the panel shows: the chat list, a new chat not sent yet, or a stored chat.
type Shown = { view: "list" } | { view: "new" } | { view: "chat"; id: string };

/** The assistant: the user's chats, and one conversation at a time. */
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const me = useQuery(authQueries.me());
  const [shown, setShown] = useState<Shown>({ view: "list" });
  const chatId = shown.view === "chat" ? shown.id : null;
  // The conversation's own query: one request for both.
  const chat = useQuery({ ...chatQueries.detail(chatId ?? ""), enabled: chatId !== null });

  const title = shown.view === "list" ? "Assistant" : shown.view === "new" ? "New chat" : (chat.data?.title ?? "Chat");
  const back =
    shown.view === "list"
      ? undefined
      : () => {
          setShown({ view: "list" });
        };

  return (
    <FloatingCard title={title} onClose={onClose} onBack={back}>
      {me.isPending && <Spinner className="mx-auto my-4" />}
      {me.data === null && (
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted-foreground">Log in to ask the assistant about an area.</p>
          <Link to="/" search={{ auth: "login" }} className={buttonVariants({ size: "sm" })}>
            Log in
          </Link>
        </div>
      )}
      {me.data && shown.view === "list" && (
        <ChatList onOpen={(id) => setShown({ view: "chat", id })} onNew={() => setShown({ view: "new" })} />
      )}
      {me.data && shown.view !== "list" && (
        <Conversation chatId={chatId} onStarted={(id) => setShown({ view: "chat", id })} />
      )}
    </FloatingCard>
  );
}
