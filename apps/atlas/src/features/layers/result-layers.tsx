import type { Job } from "@repo/contracts";
import { useQueries } from "@tanstack/react-query";
import type { ExpressionSpecification } from "maplibre-gl";
import { Layer, Source } from "react-map-gl/maplibre";
import { jobQueries } from "@/api/jobs";
import { useSelectedArea } from "@/features/area/area-store";
import { layerColor } from "./layer-color";
import { useLayerSettings } from "./layer-store";
import { drawableArtifact } from "./layers";
import { useAreaLayers } from "./use-area-layers";
import { useLayerGeometry } from "./use-layer-geometry";

const polygons: ExpressionSpecification = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];
const lines: ExpressionSpecification = [
  "in",
  ["geometry-type"],
  ["literal", ["Polygon", "MultiPolygon", "LineString", "MultiLineString"]],
];
const points: ExpressionSpecification = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];

/** Draws the selected area's completed layers on the map, stacked in the sidebar's order. */
export function ResultLayers() {
  const selected = useSelectedArea();
  const completed = useAreaLayers(selected?.area ?? null).filter((job) => job.state === "completed");
  const results = useQueries({ queries: completed.map((job) => jobQueries.result(job.id)) });
  const drawable = completed.flatMap((job, index) => {
    const result = results[index]?.data;
    const artifact = result ? drawableArtifact(result) : null;
    return artifact ? [{ job, file: artifact.file }] : [];
  });
  const files = useQueries({ queries: drawable.map(({ job, file }) => jobQueries.geojsonArtifact(job.id, file)) });
  const ready = drawable.filter((_, index) => files[index]?.data !== undefined).map(({ job }) => job);

  // Top first: each layer goes below the one above it, which is already on the map.
  return ready.map((job, index) => {
    const above = ready[index - 1];
    return <ResultLayer key={job.id} job={job} beforeId={above && bottomLayerId(above.id)} />;
  });
}

function ResultLayer({ job, beforeId }: { job: Job; beforeId: string | undefined }) {
  const { collection } = useLayerGeometry(job);
  const { visible, opacity } = useLayerSettings(job.id);

  if (!collection) return null;
  const color = layerColor(job.id);
  const layout = { visibility: visible ? ("visible" as const) : ("none" as const) };

  return (
    <Source id={`result-${job.id}`} type="geojson" data={collection}>
      <Layer
        id={bottomLayerId(job.id)}
        type="fill"
        beforeId={beforeId}
        filter={polygons}
        layout={layout}
        paint={{ "fill-color": color, "fill-opacity": 0.35 * opacity }}
      />
      <Layer
        id={`result-${job.id}-line`}
        type="line"
        beforeId={beforeId}
        filter={lines}
        layout={layout}
        paint={{ "line-color": color, "line-width": 1.5, "line-opacity": opacity }}
      />
      <Layer
        id={`result-${job.id}-circle`}
        type="circle"
        beforeId={beforeId}
        filter={points}
        layout={layout}
        paint={{ "circle-color": color, "circle-radius": 4, "circle-opacity": opacity }}
      />
    </Source>
  );
}

function bottomLayerId(jobId: string): string {
  return `result-${jobId}-fill`;
}
