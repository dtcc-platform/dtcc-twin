import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";

/**
 * Hide points of interest on the map.
 */
export function HidePointsOfInterest() {
  const map = useMap().current?.getMap();

  // The style may still be loading when the map mounts, so hide them once it has.
  useEffect(() => {
    if (!map) return;
    const hide = () => {
      hidePointsOfInterest(map);
    };
    if (map.isStyleLoaded()) hide();
    map.on("style.load", hide);
    return () => {
      map.off("style.load", hide);
    };
  }, [map]);

  return null;
}

// OpenMapTiles styles, such as OpenFreeMap's, draw them from the "poi" source layer.
function hidePointsOfInterest(map: MapLibreMap) {
  for (const layer of map.getStyle().layers) {
    if ("source-layer" in layer && layer["source-layer"] === "poi") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}
