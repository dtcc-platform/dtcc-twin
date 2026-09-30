import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useState, type ReactNode } from "react";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import { HidePointsOfInterest } from "./hide-points-of-interest";

// trap: MapLibre looks for its worker next to its own module, which Vite's bundling moves; hand it the bundled worker.
setWorkerUrl(workerUrl);

const brightStyle = "https://tiles.openfreemap.org/styles/bright";
const chalmersView = { longitude: 11.975, latitude: 57.689, zoom: 13 };

/** The full-screen map the workspace is built on; its children render inside the map once it has loaded. */
export function MapView({ children }: { children?: ReactNode }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Map
      initialViewState={chalmersView}
      mapStyle={brightStyle}
      onLoad={() => {
        setLoaded(true);
      }}
    >
      <NavigationControl position="bottom-right" />
      <HidePointsOfInterest />
      {loaded && children}
    </Map>
  );
}
