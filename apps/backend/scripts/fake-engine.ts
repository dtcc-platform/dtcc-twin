import { dtccPackage } from "../test/helpers/packages.js";
import { descriptor, startStubEngine, type StubDescriptor } from "../test/helpers/stub-engine.js";

// A stand-in for DTCC Engine, to run chats locally without its image: the e2e tests' stub, with jobs that move on
// their own: queued, then running with progress, then completed with a package whose manifest is shaped like Core's.
//
//   pnpm dev:fake-engine
//
// Then point the backend at it in apps/backend/.env: ENGINE_URL=http://127.0.0.1:8100 and
// ENGINE_API_TOKEN=local-dev-engine-token. FAKE_ENGINE_TIME_SCALE multiplies every duration (0.1 is ten times faster),
// and FAKE_ENGINE_FAIL lists Datasets whose jobs fail, such as FAKE_ENGINE_FAIL=trees.

type FakeDataset = {
  descriptor: StubDescriptor;
  seconds: number;
  headline: string;
  summary: string;
  warnings: string[];
  /** Figures for an area of this many square metres, as Core could write them into the manifest. */
  figures: (squareMetres: number) => Record<string, number>;
};

const port = Number(process.env["FAKE_ENGINE_PORT"] ?? "8100");
const token = process.env["FAKE_ENGINE_TOKEN"] ?? "local-dev-engine-token";
const timeScale = Number(process.env["FAKE_ENGINE_TIME_SCALE"] ?? "1");
const failing = new Set(
  (process.env["FAKE_ENGINE_FAIL"] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

// Core's DatasetBaseArgs, which every Dataset's arguments extend, with the Dataset's own parameters.
function argsSchema(title: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    title,
    additionalProperties: false,
    properties: {
      bounds: { type: "array", items: { type: "number" }, description: "Bounding box [minx, miny, maxx, maxy]" },
      strict_live: { type: "boolean", default: false, description: "Raise instead of degrading on fetch failures" },
      ...properties,
    },
    required: ["bounds"],
  };
}

const datasets: FakeDataset[] = [
  {
    descriptor: descriptor("footprints", {
      title: "Building footprints",
      description: "Building footprint polygons from Lantmäteriet for the requested bounds.",
      data_category: "source",
      result_kind: "building_collection",
      args_schema: argsSchema("FootprintsArgs", {
        min_area: { type: "number", default: 15, description: "Smallest footprint kept, in square metres" },
      }),
    }),
    seconds: 4,
    headline: "Building footprints",
    summary: "Footprint polygons of every building in the area, as Lantmäteriet maps them.",
    warnings: [],
    figures: (squareMetres) => ({ building_count: Math.round(squareMetres / 900) }),
  },
  {
    descriptor: descriptor("trees", {
      title: "Trees",
      description:
        "Tree locations or tree-height raster derived from vegetation returns in Lantmäteriet point cloud data for the requested bounds.",
      result_kind: "tree_collection",
      args_schema: argsSchema("TreeArgs", {
        tree_type: {
          enum: ["urban", "mixed", "dense", "arid"],
          default: "urban",
          description: "Type of trees to detect",
        },
        cell_size: { type: "number", default: 0.5, description: "Cell size of the output tree raster (in meters)" },
      }),
    }),
    seconds: 25,
    headline: "Detected Tree Layer",
    summary:
      "A derived vegetation layer that estimates tree positions or canopy-height raster cells from source point cloud classifications.",
    warnings: [
      "Tree extraction quality depends on upstream point cloud density, classification quality, and acquisition season.",
      "Derived tree objects should not be treated as surveyed individual-tree inventory.",
    ],
    figures: (squareMetres) => ({ tree_count: Math.round(squareMetres / 150), mean_height_m: 9.4 }),
  },
  {
    descriptor: descriptor("air_quality", {
      title: "Air quality",
      description: "Simulated NO2 concentration at street level over the requested bounds.",
      data_category: "simulation",
      result_kind: "field",
      timeout_hint: 1800,
      args_schema: argsSchema("AirQualityArgs", {
        hours: { type: "integer", default: 24, description: "Hours of weather to simulate" },
      }),
    }),
    seconds: 150,
    headline: "Air quality (NO2)",
    summary: "Street-level NO2 concentration from a dispersion simulation over the area.",
    warnings: ["Traffic emissions are estimated from road class, not measured counts."],
    figures: () => ({ mean_no2_ug_m3: 18.2, max_no2_ug_m3: 41.7 }),
  },
];

function manifest(dataset: FakeDataset, parameters: Record<string, unknown>): Record<string, unknown> {
  const bounds = Array.isArray(parameters["bounds"]) ? (parameters["bounds"] as number[]) : null;
  const [minX = 0, minY = 0, maxX = 0, maxY = 0] = bounds ?? [];
  const { name, title, description, data_category, result_kind } = dataset.descriptor;
  return {
    schema_version: "dtcc-dataset-manifest-v3",
    identity: { name, title, version: null },
    metadata: { description, data_category, result_kind },
    provenance: { sources: [], processing_steps: [], generated_by: "fake DTCC Engine", derived_from: [] },
    presentation: { headline: dataset.headline, summary: dataset.summary, warnings: dataset.warnings, limitations: [] },
    request: { dataset_name: name, parameters, bounds },
    artifacts: [{ path: "model.pb", role: "canonical_model", format: "dtcc", media_type: "application/x-protobuf" }],
    // Not in Core's manifests yet: figures a model could answer from, as Core might add them.
    summary: dataset.figures((maxX - minX) * (maxY - minY)),
  };
}

const engine = await startStubEngine(token, { port });
engine.setDatasets(datasets.map((dataset) => dataset.descriptor));

function run(jobId: string, body: unknown): void {
  const request = body as { dataset?: string; parameters?: Record<string, unknown> };
  const dataset = datasets.find((candidate) => candidate.descriptor.name === request.dataset);
  const durationMs = (dataset?.seconds ?? 5) * 1000 * timeScale;
  const startedAt = Date.now();
  console.log(`job ${jobId}: ${request.dataset ?? "?"} queued, done in ${String(Math.round(durationMs / 1000))} s`);

  const ticking = setInterval(() => {
    const percent = Math.min(99, ((Date.now() - startedAt) / durationMs) * 100);
    engine.setJob(jobId, "running", { percent, message: "Working", phase: null });
  }, 500);

  setTimeout(() => {
    clearInterval(ticking);
    if (!dataset || failing.has(dataset.descriptor.name)) {
      engine.failJob(jobId, dataset ? "FakeFailure" : "UnknownDataset");
      console.log(`job ${jobId}: failed`);
      return;
    }
    void dtccPackage(manifest(dataset, request.parameters ?? {})).then((bytes) => {
      engine.completeJob(jobId, bytes);
      console.log(`job ${jobId}: completed`);
    });
  }, durationMs);
}

let seen = 0;
const watching = setInterval(() => {
  for (const submission of engine.submissions.slice(seen)) if (submission.jobId) run(submission.jobId, submission.body);
  seen = engine.submissions.length;
}, 200);

console.log(
  `Fake DTCC Engine at ${engine.url}, token ${token}; Datasets: ${datasets.map((d) => d.descriptor.name).join(", ")}`,
);

process.on("SIGINT", () => {
  clearInterval(watching);
  void engine.close().then(() => process.exit(0));
});
