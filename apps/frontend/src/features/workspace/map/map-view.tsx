import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { ReactNode } from "react";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import { HidePointsOfInterest } from "./hide-points-of-interest";

// trap: MapLibre looks for its worker next to its own module, which Vite's bundling moves; hand it the bundled worker.
setWorkerUrl(workerUrl);

const brightStyle = "https://tiles.openfreemap.org/styles/bright";
const chalmersView = { longitude: 11.975, latitude: 57.689, zoom: 15 };

/** The full-screen map the workspace is built on; its children render inside the map. */
export function MapView({ children }: { children?: ReactNode }) {
  return (
    <Map initialViewState={chalmersView} mapStyle={brightStyle}>
      <NavigationControl position="bottom-right" />
      <HidePointsOfInterest />
      {children}
    </Map>
  );
}
