import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/features/map/map-view";

export const Route = createFileRoute("/")({ component: Workspace });

function Workspace() {
  return (
    <main className="h-svh">
      <MapView />
    </main>
  );
}
