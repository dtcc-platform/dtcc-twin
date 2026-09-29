import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/features/workspace/workspace";

export const Route = createFileRoute("/")({ component: WorkspacePage });

function WorkspacePage() {
  return (
    <main className="relative h-svh">
      <Workspace />
    </main>
  );
}
