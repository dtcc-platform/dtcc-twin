import type { StyleSpecification } from "maplibre-gl";
import { useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { areaDrawLayerPrefix } from "@/features/area/area-draw";
import { basemaps, defaultBasemap } from "./basemaps";
import { atlasMapId } from "./map-id";

export function BasemapSelect() {
  const map = useMap()[atlasMapId];
  const [basemapId, setBasemapId] = useState(defaultBasemap.id);

  function change(id: string) {
    const basemap = basemaps.find((candidate) => candidate.id === id);
    if (!basemap) return;
    setBasemapId(id);
    map?.getMap().setStyle(basemap.style, { transformStyle: keepDrawnArea });
  }

  return (
    <NativeSelect
      aria-label="Basemap"
      size="sm"
      className="bg-background"
      value={basemapId}
      onChange={(event) => {
        change(event.target.value);
      }}
    >
      {basemaps.map((basemap) => (
        <NativeSelectOption key={basemap.id} value={basemap.id}>
          {basemap.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

// trap: a new style replaces every source and layer, the drawn area's too, and Terra Draw never re-adds them.
function keepDrawnArea(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!previous) return next;
  const isDrawnArea = (id: string) => id.startsWith(areaDrawLayerPrefix);
  const drawnSources = Object.entries(previous.sources).filter(([id]) => isDrawnArea(id));
  const drawnLayers = previous.layers.filter((layer) => isDrawnArea(layer.id));
  return {
    ...next,
    sources: { ...next.sources, ...Object.fromEntries(drawnSources) },
    layers: [...next.layers, ...drawnLayers],
  };
}
