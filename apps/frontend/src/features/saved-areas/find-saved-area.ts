import type { SavedArea } from "@repo/contracts";
import type { Area } from "@/features/area/area";

/**
 * The saved area with exactly this box, if any. Loading a saved area sets its exact numbers, so this catches saving it
 * again; a drawn box that only comes close is a different area.
 */
export function findSavedArea(area: Area | null, savedAreas: SavedArea[]): SavedArea | undefined {
  if (!area) return undefined;
  return savedAreas.find(
    ({ area: saved }) =>
      saved.west === area.west && saved.south === area.south && saved.east === area.east && saved.north === area.north,
  );
}
