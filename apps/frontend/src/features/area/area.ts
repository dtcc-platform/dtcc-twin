import { sweref } from "@/lib/sweref";

/** The area as drawn on the map: a WGS84 box in degrees. */
export type Area = { west: number; south: number; east: number; north: number };

/** EPSG:3006 bounds in whole metres, `[minX, minY, maxX, maxY]`: what Datasets take as `bounds`. */
export type SwerefBounds = [number, number, number, number];

export const minSquareMetres = 25;
export const maxSquareMetres = 25_000_000;

/** The EPSG:3006 box between the south-west and north-east corners, as DTCC Core computes it. */
export function swerefBounds(area: Area): SwerefBounds {
  const [minX, minY] = sweref.forward([area.west, area.south]);
  const [maxX, maxY] = sweref.forward([area.east, area.north]);
  return [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)];
}

export function areaSquareMetres(area: Area): number {
  const [minX, minY, maxX, maxY] = swerefBounds(area);
  return (maxX - minX) * (maxY - minY);
}

const squareMetresFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const squareKilometresFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole square metres under a hectare, square kilometres from there. */
export function formatSquareMetres(squareMetres: number): string {
  if (squareMetres < 10_000) return `${squareMetresFormat.format(squareMetres)} m²`;
  return `${squareKilometresFormat.format(squareMetres / 1_000_000)} km²`;
}

export function areaSizeProblem(squareMetres: number): string | undefined {
  if (squareMetres < minSquareMetres) return "Under the 25 m² minimum";
  if (squareMetres > maxSquareMetres) return "Over the 25 km² limit";
  return undefined;
}
