import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { agentQueries } from "@/api/agent";
import { authQueries } from "@/api/auth";
import { FloatingCard } from "@/components/common/floating-card";
import { buttonVariants } from "@/components/ui/button";
import { useAreaStore } from "@/features/area/area-store";
import { workspaceMapId } from "@/features/workspace/map/map-view";
import { ChatList } from "./chat-list";
import { ChatView } from "./chat-view";

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const me = useQuery(authQueries.me());
  const [selected, setSelected] = useState<string | null>(null);
  const client = useQueryClient();
  const map = useMap()[workspaceMapId];
  const { setArea } = useAreaStore((state) => state.actions);
  async function open(id: string) {
    try {
      const chat = await client.query(agentQueries.detail(id));
      if (chat.area) {
        const { west, south, east, north } = chat.area;
        setArea(chat.area);
        map?.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 80 },
        );
      }
      setSelected(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The chat could not be opened.");
    }
  }
  return (
    <FloatingCard
      title="Agent"
      onClose={onClose}
      {...(selected
        ? {
            onBack: () => {
              setSelected(null);
            },
          }
        : {})}
    >
      {me.data === null && (
        <div className="flex flex-col gap-3 text-sm">
          <p>Log in to ask about your drawn area.</p>
          <Link to="/" search={{ auth: "login" }} className={buttonVariants({ size: "sm" })}>
            Log in
          </Link>
        </div>
      )}
      {me.data &&
        (selected ? (
          <ChatView key={selected} id={selected} active={me.data.status === "active"} />
        ) : (
          <ChatList
            onOpen={(id) => {
              void open(id);
            }}
          />
        ))}
    </FloatingCard>
  );
}
