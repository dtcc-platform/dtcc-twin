import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";

/** Hides shop, restaurant, parking and other point-of-interest icons, which compete with the data on the map. */
export function HidePointsOfInterest() {
  const map = useMap().current?.getMap();

  // Every basemap switch loads a new style, so hide them again each time.
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
