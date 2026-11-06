import { buffer } from "node:stream/consumers";
import { ZipFile } from "yazl";

/** A zip holding `files`, as a `.dtccpkg` is: `await zipped({ "manifest.json": "{}" })`. */
export async function zipped(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name);
  zip.end();
  return buffer(zip.outputStream);
}

/** A manifest shaped like Core's canonical v3 one (`dtcc_core/datasets/schema.py`), for the given Dataset. */
export function manifestOf(dataset: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "dtcc-dataset-manifest-v3",
    identity: { name: dataset, title: `Title of ${dataset}`, version: null },
    metadata: { description: `Description of ${dataset}`, data_category: "derived", result_kind: "tree_collection" },
    provenance: { sources: [], processing_steps: [], generated_by: "dtcc-core", derived_from: [] },
    presentation: {
      headline: `Headline of ${dataset}`,
      summary: `Summary of ${dataset}`,
      warnings: [],
      limitations: [],
    },
    request: { dataset_name: dataset, parameters: {}, bounds: [319891, 6399790, 320091, 6399990] },
    artifacts: [{ path: "model.pb", role: "canonical_model", format: "dtcc", media_type: "application/x-protobuf" }],
    ...overrides,
  };
}

/** A package as the engine delivers it: the manifest and a stand-in for the model it describes. */
export function dtccPackage(manifest: Record<string, unknown>): Promise<Buffer> {
  return zipped({ "manifest.json": JSON.stringify(manifest), "model.pb": Buffer.alloc(256) });
}
