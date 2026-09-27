import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";

const blank = { width: 1, height: 1, data: new Uint8Array(4) };

/**
 * OpenFreeMap's styles name some icons their sprite lacks; each would log a warning on every tile. Supplying a blank
 * image instead leaves those places without an icon, as they are anyway.
 */
export function BlankMissingIcons() {
  const map = useMap().current?.getMap();

  // Hooks into MapLibre, outside React.
  useEffect(() => {
    if (!map) return;
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) map.addImage(id, blank);
    });
    return () => {
      map.setMissingStyleImageResolver(null);
    };
  }, [map]);

  return null;
}
