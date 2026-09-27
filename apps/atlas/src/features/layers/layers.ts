import type { Job, JobArtifact, JobResult } from "@repo/contracts";

/** The jobs run on exactly these EPSG:3006 bounds: an area's layers. */
export function jobsOnBounds(jobs: Job[], bounds: number[]): Job[] {
  return jobs.filter((job) => sameBounds(job.parameters["bounds"], bounds));
}

function sameBounds(candidate: unknown, bounds: number[]): boolean {
  return (
    Array.isArray(candidate) &&
    candidate.length === bounds.length &&
    candidate.every((value, index) => value === bounds[index])
  );
}

/** An area's layers in display order, top first: jobs not yet arranged on top, newest first, then the saved order. */
export function arrangeLayers(jobs: Job[], order: string[], removed: string[]): Job[] {
  const kept = jobs.filter((job) => !removed.includes(job.id));
  const unarranged = kept.filter((job) => !order.includes(job.id));
  const arranged = order.flatMap((id) => kept.filter((job) => job.id === id));
  return [...unarranged, ...arranged];
}

/** The saved order after moving one of an area's layers a place up or down. */
export function reorder(order: string[], areaLayerIds: string[], id: string, direction: "up" | "down"): string[] {
  const moved = [...areaLayerIds];
  const from = moved.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  const neighbour = moved[to];
  if (from >= 0 && neighbour !== undefined) {
    moved[to] = id;
    moved[from] = neighbour;
  }
  return [...moved, ...order.filter((entry) => !moved.includes(entry))];
}

/** The artifact the map can draw: GeoJSON in WGS84 or EPSG:3006. */
export function drawableArtifact(result: JobResult): JobArtifact | null {
  const drawable = result.artifacts.find(
    (artifact) => artifact.mediaType === "application/geo+json" && mapCoordinateSystems.includes(artifact.crs),
  );
  return drawable ?? null;
}

// No CRS means GeoJSON's default, WGS84.
const mapCoordinateSystems: (string | null)[] = [null, "EPSG:4326", "EPSG:3006"];
