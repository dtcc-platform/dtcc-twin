import { sweref } from "@/lib/sweref";

/** The area as drawn on the map: a WGS84 box in degrees. */
export type Area = { west: number; south: number; east: number; north: number };

/** EPSG:3006 bounds in whole metres, `[minX, minY, maxX, maxY]`: what Datasets take as `bounds`. */
export type SwerefBounds = [number, number, number, number];

/** Degrees to six decimals, about 10 cm: the precision the bounds inspector shows and sets. */
export function roundDegrees(degrees: number): number {
  return Number(degrees.toFixed(6));
}

export const minSquareMetres = 25;
export const maxSquareMetres = 25_000_000;

/**
 * The EPSG:3006 bounds that contain the whole area, so its data covers everything drawn.
 * The grid is turned against longitude and latitude, so they reach past the box on two sides.
 */
export function areaBounds({ west, south, east, north }: Area): SwerefBounds {
  const corners = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ].map((corner) => sweref.forward(corner));
  const xs = corners.map(([x]) => x ?? Number.NaN);
  const ys = corners.map(([, y]) => y ?? Number.NaN);
  return [
    Math.floor(Math.min(...xs)),
    Math.floor(Math.min(...ys)),
    Math.ceil(Math.max(...xs)),
    Math.ceil(Math.max(...ys)),
  ];
}

export function areaSquareMetres(area: Area): number {
  const [minX, minY, maxX, maxY] = areaBounds(area);
  return (maxX - minX) * (maxY - minY);
}

const squareMetresFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const squareKilometresFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole square metres under a hectare, square kilometres from there. */
export function formatSquareMetres(squareMetres: number): string {
  if (squareMetres < 10_000) return `${squareMetresFormat.format(squareMetres)} m²`;
  return `${squareKilometresFormat.format(squareMetres / 1_000_000)} km²`;
}

export type AreaSizeProblem = "too-small" | "too-large";

export function areaSizeProblem(squareMetres: number): AreaSizeProblem | undefined {
  if (squareMetres < minSquareMetres) return "too-small";
  if (squareMetres > maxSquareMetres) return "too-large";
  return undefined;
}

export const areaSizeProblemText: Record<AreaSizeProblem, string> = {
  "too-small": `Under the ${String(minSquareMetres)} m² minimum`,
  "too-large": `Over the ${String(maxSquareMetres / 1_000_000)} km² limit`,
};
