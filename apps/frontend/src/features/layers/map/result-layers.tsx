import { useQuery } from "@tanstack/react-query";
import { Layer, Source } from "react-map-gl/maplibre";
import { jobQueries } from "@/api/jobs";
import { useLayersStore, type ResultLayer } from "../layers-store.ts";

/** The results in the layers store, on the map. */
export function ResultLayers() {
  const layers = useLayersStore((state) => state.layers);
  return layers.map((layer) => <JobResult key={layer.jobId} layer={layer} />);
}

/** One job's result, once the job has completed with a file the map draws. */
function JobResult({ layer }: { layer: ResultLayer }) {
  const job = useQuery(jobQueries.detail(layer.jobId));
  if (job.data?.state !== "completed") return null;
  if (job.data.artifactFormat === "geojson") return <GeoJsonResult layer={layer} />;
  return null;
}

/** Areas filled, lines and area outlines drawn, and points as dots, all in the layer's color. */
function GeoJsonResult({ layer }: { layer: ResultLayer }) {
  const geojson = useQuery(jobQueries.geojson(layer.jobId));
  if (!geojson.data) return null;

  const id = `result-${layer.jobId}`;
  return (
    <Source id={id} type="geojson" data={geojson.data}>
      <Layer
        id={`${id}-areas`}
        type="fill"
        filter={["==", ["geometry-type"], "Polygon"]}
        paint={{ "fill-color": layer.color, "fill-opacity": 0.25 }}
      />
      <Layer
        id={`${id}-lines`}
        type="line"
        filter={["!=", ["geometry-type"], "Point"]}
        paint={{ "line-color": layer.color, "line-width": 2 }}
      />
      <Layer
        id={`${id}-points`}
        type="circle"
        filter={["==", ["geometry-type"], "Point"]}
        paint={{
          "circle-color": layer.color,
          "circle-radius": 4,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
        }}
      />
    </Source>
  );
}
