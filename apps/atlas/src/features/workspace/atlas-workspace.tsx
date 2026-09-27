import { MapProvider } from "react-map-gl/maplibre";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AreaCard } from "@/features/area/area-card";
import { useSelectedArea } from "@/features/area/area-store";
import { AreaStoreProvider } from "@/features/area/area-store-provider";
import { LayerStoreProvider } from "@/features/layers/layer-store-provider";
import { LayersCard } from "@/features/layers/layers-card";
import { AtlasMap } from "@/features/map/atlas-map";

/** The Atlas page: the area and its layers in a resizable sidebar, the map beside it. */
export function AtlasWorkspace() {
  return (
    <AreaStoreProvider>
      <LayerStoreProvider>
        <MapProvider>
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize={380} minSize={300} maxSize="50" groupResizeBehavior="preserve-pixel-size">
              <Sidebar />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel>
              <AtlasMap />
            </ResizablePanel>
          </ResizablePanelGroup>
        </MapProvider>
      </LayerStoreProvider>
    </AreaStoreProvider>
  );
}

function Sidebar() {
  const selected = useSelectedArea();

  return (
    <aside aria-label="Workspace" className="flex h-full flex-col gap-3 overflow-y-auto bg-muted/50 p-3 text-sm">
      <AreaCard />
      {/* Layers belong to an area, so they only show with one selected. */}
      {selected && <LayersCard area={selected.area} />}
    </aside>
  );
}
