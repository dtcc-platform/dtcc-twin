import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import { AreaDraw } from "@/features/area/area-draw";
import { ResultLayers } from "@/features/layers/result-layers";
import { BasemapSelect } from "./basemap-select";
import { defaultBasemap } from "./basemaps";
import { BlankMissingIcons } from "./blank-missing-icons";
import { demoArea } from "./demo-area";
import { HidePointsOfInterest } from "./hide-points-of-interest";
import { atlasMapId } from "./map-id";

// trap: MapLibre looks for its worker next to its own module, which Vite's bundling moves; hand it the bundled worker.
setWorkerUrl(workerUrl);

/** The map, with only the controls about the map itself on it; the workflow lives in the sidebar. */
export function AtlasMap() {
  return (
    <div className="relative h-full">
      <Map
        id={atlasMapId}
        initialViewState={{ bounds: demoArea, fitBoundsOptions: { padding: 40 } }}
        mapStyle={defaultBasemap.style}
      >
        <NavigationControl position="top-right" />
        <BlankMissingIcons />
        <HidePointsOfInterest />
        <AreaDraw />
        <ResultLayers />
      </Map>
      <div className="absolute top-2.5 left-2.5 rounded-lg shadow-sm">
        <BasemapSelect />
      </div>
    </div>
  );
}
