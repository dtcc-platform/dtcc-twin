import { createFileRoute } from "@tanstack/react-router";
import { AtlasWorkspace } from "@/features/workspace/atlas-workspace";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="h-[calc(100svh-var(--site-header-height))]">
      <AtlasWorkspace />
    </main>
  );
}
