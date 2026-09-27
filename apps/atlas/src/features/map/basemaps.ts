import type { StyleSpecification } from "maplibre-gl";

export type Basemap = { id: string; label: string; style: string | StyleSpecification };

const cartoKey = import.meta.env.VITE_CARTO_API_KEY;

export const defaultBasemap: Basemap = {
  id: "bright",
  label: "Bright",
  style: "https://tiles.openfreemap.org/styles/bright",
};

export const basemaps: Basemap[] = [
  defaultBasemap,
  { id: "liberty", label: "Liberty", style: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "positron", label: "Positron", style: "https://tiles.openfreemap.org/styles/positron" },
  ...(cartoKey ? [{ id: "voyager", label: "Carto Voyager (old Atlas)", style: cartoVoyager(cartoKey) }] : []),
];

// The old Atlas's basemap: raster tiles, so nothing on it is 3D.
function cartoVoyager(key: string): StyleSpecification {
  const tiles = ["a", "b", "c", "d"].map(
    (subdomain) => `https://${subdomain}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=${key}`,
  );
  return {
    version: 8,
    sources: {
      voyager: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [{ id: "voyager", type: "raster", source: "voyager" }],
  };
}
