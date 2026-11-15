import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MapProvider } from "react-map-gl/maplibre";
import { useStore } from "zustand";
import { authQueries } from "@/api/auth";
import { FloatingCard } from "@/components/common/floating-card";
import { AreaDraw } from "@/features/area/box/area-draw";
import { AreaSizeLabel } from "@/features/area/box/area-size-label";
import { AreaStoreContext, createAreaStore } from "@/features/area/area-store";
import { BoundsInspector } from "@/features/area/bounds-inspector/bounds-inspector";
import { DatasetsPanel } from "@/features/datasets/datasets-panel";
import { DownloadsPanel } from "@/features/jobs/downloads-panel";
import { LayersStoreContext, createLayersStore } from "@/features/layers/layers-store";
import { ResultLayers } from "@/features/layers/map/result-layers";
import { LayersPanel } from "@/features/layers/panel/layers-panel";
import { SavedAreasPanel } from "@/features/saved-areas/saved-areas-panel";
import { HintBar } from "@/features/workspace/hint-bar/hint-bar";
import { MapView } from "@/features/workspace/map/map-view";
import { Toolbar } from "@/features/workspace/toolbar/toolbar";
import { TopBar } from "@/features/workspace/top-bar/top-bar";
import { cn } from "@/lib/utils";
import { WorkspaceStoreContext, createWorkspaceStore } from "./workspace-store";

const column = "pointer-events-none flex w-88 flex-col gap-2 *:pointer-events-auto";

export function Workspace() {
  const [store] = useState(createWorkspaceStore);
  const right = useStore(store, (state) => state.right);
  const left = useStore(store, (state) => state.left);
  const { closeRight, closeLeft } = useStore(store, (state) => state.actions);
  const [areaStore] = useState(createAreaStore);
  const { cancelDrawing } = useStore(areaStore, (state) => state.actions);
  // A fresh store whenever the logged-in user changes, so no one sees, or polls, another user's results.
  const userId = useQuery(authQueries.me()).data?.id ?? null;
  const [layers, setLayers] = useState(() => ({ userId, store: createLayersStore() }));
  if (layers.userId !== userId) setLayers({ userId, store: createLayersStore() });

  // close the panels and cancel a drawing on Esc
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeRight();
      closeLeft();
      cancelDrawing();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeRight, closeLeft, cancelDrawing]);

  return (
    <MapProvider>
      <WorkspaceStoreContext value={store}>
        <AreaStoreContext value={areaStore}>
          <LayersStoreContext value={layers.store}>
            <MapView>
              <AreaDraw />
              <AreaSizeLabel />
              <ResultLayers />
            </MapView>
            <TopBar />
            <div className="pointer-events-none absolute top-17 bottom-3 left-3 z-10 flex items-start gap-2">
              <Toolbar />
              {left && (
                <div
                  key={left}
                  className={cn(column, "self-stretch animate-in duration-200 fade-in slide-in-from-left-2")}
                >
                  {left === "layers" && <LayersPanel onClose={closeLeft} />}
                  {left === "bounds" && <BoundsInspector onClose={closeLeft} />}
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
                {right === "bookmarks" && <SavedAreasPanel onClose={closeRight} />}
                {right === "datasets" && <DatasetsPanel kind="datasets" onClose={closeRight} />}
                {right === "simulations" && <DatasetsPanel kind="simulations" onClose={closeRight} />}
                {right === "downloads" && <DownloadsPanel onClose={closeRight} />}
                {right === "upload" && <FloatingCard title="Upload" onClose={closeRight} />}
              </div>
            )}
            <HintBar />
          </LayersStoreContext>
        </AreaStoreContext>
      </WorkspaceStoreContext>
    </MapProvider>
  );
}
