import { z } from "zod";
import { sweref } from "@/lib/sweref";

/** The selected area as drawn on the map: a WGS84 box in degrees. */
export type Area = { west: number; south: number; east: number; north: number };

/** EPSG:3006 bounds in metres, `[minX, minY, maxX, maxY]`: what Datasets take as `bounds`. */
export type SwerefBounds = [number, number, number, number];

const minSquareMetres = 25;
const maxSquareMetres = 25_000_000;

/**
 * The EPSG:3006 box between the south-west and north-east corners, as the old Atlas did. On the grid the WGS84 box
 * is rotated slightly, so thin slivers at its north-west and south-east corners fall outside.
 */
export function swerefBounds(area: Area): SwerefBounds {
  const [minX, minY] = sweref.forward([area.west, area.south]);
  const [maxX, maxY] = sweref.forward([area.east, area.north]);
  return [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)];
}

export function areaSquareMetres(area: Area): number {
  const [minX, minY, maxX, maxY] = swerefBounds(area);
  return (maxX - minX) * (maxY - minY);
}

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** The bounds inspector's fields, with the limits the draw tool applies. */
export const areaFormSchema = z
  .object({ west: longitude, south: latitude, east: longitude, north: latitude })
  .superRefine((area, context) => {
    const inverted = area.north <= area.south || area.east <= area.west;
    if (area.north <= area.south) {
      context.addIssue({ code: "custom", path: ["north"], message: "North must be greater than south" });
    }
    if (area.east <= area.west) {
      context.addIssue({ code: "custom", path: ["east"], message: "East must be greater than west" });
    }
    if (inverted) return;

    const squareMetres = areaSquareMetres(area);
    if (squareMetres < minSquareMetres) {
      context.addIssue({ code: "custom", message: "The area must be at least 25 m²" });
    }
    if (squareMetres > maxSquareMetres) {
      context.addIssue({ code: "custom", message: "The area must be at most 25 km²" });
    }
  });
