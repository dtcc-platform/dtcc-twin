import { useEffect } from "react";
import { MapView } from "@/features/map/map-view";
import { Toolbar } from "@/features/toolbar/toolbar";
import { TopBar } from "@/features/top-bar/top-bar";
import { LeftColumn, RightColumn } from "./panel-columns";
import { WorkspaceStoreProvider } from "./workspace-store-provider";
import { useWorkspaceActions } from "./workspace-store";

/** The full-screen map with the top bar, toolbar and panel columns over it. */
export function Workspace() {
  return (
    <WorkspaceStoreProvider>
      <main className="relative h-svh">
        <MapView />
        <TopBar />
        {/* One row, so the left column moves aside as the toolbar widens. Only the toolbar and panels take clicks. */}
        <div className="pointer-events-none absolute top-17 bottom-3 left-3 z-10 flex items-start gap-2">
          <Toolbar />
          <LeftColumn />
        </div>
        <RightColumn />
        <CloseOnEscape />
      </main>
    </WorkspaceStoreProvider>
  );
}

// On window rather than <main>, so Esc works wherever focus is, including on the page body.
function CloseOnEscape() {
  const { closeRight, closeLeft } = useWorkspaceActions();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeRight();
      closeLeft();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeRight, closeLeft]);

  return null;
}
