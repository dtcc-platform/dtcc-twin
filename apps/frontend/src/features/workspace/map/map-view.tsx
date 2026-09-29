import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import { HidePointsOfInterest } from "./hide-points-of-interest";

// trap: MapLibre looks for its worker next to its own module, which Vite's bundling moves; hand it the bundled worker.
setWorkerUrl(workerUrl);

const brightStyle = "https://tiles.openfreemap.org/styles/bright";
const swedenView = { longitude: 15, latitude: 62, zoom: 5 };

/** The full-screen map the workspace is built on. */
export function MapView() {
  return (
    <Map initialViewState={swedenView} mapStyle={brightStyle}>
      <NavigationControl position="bottom-right" />
      <HidePointsOfInterest />
    </Map>
  );
}
