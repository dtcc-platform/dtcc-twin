import { strFromU8, unzipSync } from "fflate";
import { engineManifestSchema, type EngineManifest } from "../engine/engine.schemas.js";

/** One file from a `.dtccpkg` archive, or undefined when the archive has no such entry. */
export function readPackageEntry(archive: Uint8Array, path: string): Uint8Array | undefined {
  const entries = unzipSync(archive, { filter: (entry) => entry.name === path });
  return entries[path];
}

export function readPackageManifest(archive: Uint8Array): EngineManifest {
  const manifest = readPackageEntry(archive, "manifest.json");
  if (!manifest) throw new Error("The package has no manifest.json");
  return engineManifestSchema.parse(JSON.parse(strFromU8(manifest)));
}
