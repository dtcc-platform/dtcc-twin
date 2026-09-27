import type { Job, JobArtifact, JobResult } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { jobQueries } from "@/api/jobs";
import { extentOf, toMapCoordinates, type Extent } from "./geojson";
import { drawableArtifact } from "./layers";

type LayerGeometry = {
  result: JobResult | undefined;
  /** The artifact the map can draw, or null when the result has none. */
  artifact: JobArtifact | null;
  /** The artifact in WGS84, once loaded. */
  collection: GeoJSON.FeatureCollection | null;
  extent: Extent | null;
};

/** What a completed job looks like on the map; empty until its result and artifact have loaded. */
export function useLayerGeometry(job: Job): LayerGeometry {
  const result = useQuery({ ...jobQueries.result(job.id), enabled: job.state === "completed" });
  const artifact = result.data ? drawableArtifact(result.data) : null;
  const file = useQuery({ ...jobQueries.geojsonArtifact(job.id, artifact?.file ?? ""), enabled: artifact !== null });
  const crs = artifact?.crs ?? null;

  // Converting a few thousand coordinates is cheap, but not on every render.
  const collection = useMemo(() => (file.data ? toMapCoordinates(file.data, crs) : null), [file.data, crs]);
  const extent = useMemo(() => (collection ? extentOf(collection) : null), [collection]);

  return { result: result.data, artifact, collection, extent };
}
