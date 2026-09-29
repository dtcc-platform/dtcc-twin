import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/features/map/map-view";
import { TopBar } from "@/features/top-bar/top-bar";

export const Route = createFileRoute("/")({ component: Workspace });

function Workspace() {
  return (
    <main className="relative h-svh">
      <MapView />
      <TopBar />
    </main>
  );
}
