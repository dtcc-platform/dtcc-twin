import type { SavedArea } from "@repo/contracts";
import { roundDegrees, type Area } from "@/features/area/area";

const sides = ["west", "south", "east", "north"] as const;

/**
 * The saved area with this box, if any, compared at the bounds inspector's precision: setting a loaded area again
 * through the inspector rounds it to six decimals, and it is still the same area.
 */
export function findSavedArea(area: Area | null, savedAreas: SavedArea[]): SavedArea | undefined {
  if (!area) return undefined;
  return savedAreas.find((saved) => sides.every((side) => roundDegrees(saved.area[side]) === roundDegrees(area[side])));
}
