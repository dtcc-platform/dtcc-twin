import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { FloatingCard } from "@/components/floating-card";
import { MapView } from "@/features/map/map-view";
import { Toolbar } from "@/features/toolbar/toolbar";
import { TopBar } from "@/features/top-bar/top-bar";
import { cn } from "@/lib/utils";
import { WorkspaceStoreContext, createWorkspaceStore } from "./workspace-store";

const column = "pointer-events-none flex w-72 flex-col gap-2 *:pointer-events-auto";

export function Workspace() {
  const [store] = useState(createWorkspaceStore);
  const right = useStore(store, (state) => state.right);
  const left = useStore(store, (state) => state.left);
  const { closeRight, closeLeft } = useStore(store, (state) => state.actions);

  // close the panels on Esc
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

  return (
    <WorkspaceStoreContext value={store}>
      <MapView />
      <TopBar />
      <div className="pointer-events-none absolute top-17 bottom-3 left-3 z-10 flex items-start gap-2">
        <Toolbar />
        {left && (
          <div key={left} className={cn(column, "self-stretch animate-in duration-200 fade-in slide-in-from-left-2")}>
            <FloatingCard title="Layers" onClose={closeLeft} />
          </div>
        )}
      </div>
      {right && (
        <div
          key={right}
          className={cn(
            column,
            "absolute top-17 right-3 bottom-3 z-10 animate-in duration-200 fade-in slide-in-from-right-2",
          )}
        >
          {right === "bookmarks" && <FloatingCard title="Bookmarks" onClose={closeRight} />}
          {right === "datasets" && <FloatingCard title="Datasets" onClose={closeRight} />}
          {right === "simulations" && <FloatingCard title="Simulations" onClose={closeRight} />}
          {right === "downloads" && <FloatingCard title="Downloads" onClose={closeRight} />}
          {right === "upload" && <FloatingCard title="Upload" onClose={closeRight} />}
        </div>
      )}
    </WorkspaceStoreContext>
  );
}
