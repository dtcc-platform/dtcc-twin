import type { AreaBox } from "@repo/contracts";
import proj4 from "proj4";

export type SwerefBounds = [number, number, number, number];
const sweref = proj4("EPSG:4326", "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

export function areaBounds({ west, south, east, north }: AreaBox): SwerefBounds {
  const corners = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ].map((point) => sweref.forward(point));
  const xs = corners.map(([x]) => x ?? Number.NaN);
  const ys = corners.map(([, y]) => y ?? Number.NaN);
  return [
    Math.floor(Math.min(...xs)),
    Math.floor(Math.min(...ys)),
    Math.ceil(Math.max(...xs)),
    Math.ceil(Math.max(...ys)),
  ];
}

export function areaSquareMetres(area: AreaBox): number {
  const [west, south, east, north] = areaBounds(area);
  return (east - west) * (north - south);
}
