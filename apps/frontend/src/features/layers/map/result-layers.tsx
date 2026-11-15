import { useQuery } from "@tanstack/react-query";
import { Layer, Source } from "react-map-gl/maplibre";
import { jobFileUrl, jobQueries } from "@/api/jobs";
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
  if (job.data.artifactFormat === "png") return <ImageResult layer={layer} />;
  return null;
}

/** The image stretched between its corners, which the artifact's metadata gives in longitude and latitude. */
function ImageResult({ layer }: { layer: ResultLayer }) {
  const metadata = useQuery(jobQueries.artifactMetadata(layer.jobId));
  if (!metadata.data?.boundsWgs84) return null;

  const [west, south, east, north] = metadata.data.boundsWgs84;
  const id = `result-${layer.jobId}`;
  return (
    <Source
      id={id}
      type="image"
      url={jobFileUrl(layer.jobId, "artifact")}
      coordinates={[
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ]}
    >
      <Layer id={`${id}-image`} type="raster" paint={{ "raster-opacity": 0.85 }} />
    </Source>
  );
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
