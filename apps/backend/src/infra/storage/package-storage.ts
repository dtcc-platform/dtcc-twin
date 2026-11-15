import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { openPromise, type Entry, type ZipFile } from "yauzl";
import { z } from "zod";
import type { Env } from "../../config/env.schema.js";

// The part of an artifact's entry in manifest.json (Core's dtcc-dataset-manifest-v3) that the backend reads.
const manifestArtifactSchema = z.object({
  path: z.string(),
  role: z.string(),
  format: z.string().regex(/^[a-z0-9]+$/),
  placement: z.object({ bounds_wgs84: z.tuple([z.number(), z.number(), z.number(), z.number()]) }).nullish(),
  rendering: z
    .object({
      field: z.string().nullable(),
      unit: z.string().nullable(),
      value_range: z.tuple([z.number(), z.number()]).nullable(),
      colormap: z.string().nullable(),
    })
    .nullish(),
});
const manifestSchema = z.object({ artifacts: z.array(manifestArtifactSchema) });

/** The extra file's entry in a package's manifest, as Core wrote it. */
export type ManifestArtifact = z.infer<typeof manifestArtifactSchema>;

/** The extra file Core added to a package: its format, such as `geojson`, and its content. */
export type PackageArtifact = { format: string; content: Readable };

type PackageContents = { zip: ZipFile; artifact: { manifest: ManifestArtifact; zipEntry: Entry } | null };

/** Stores DTCC Engine packages under PACKAGE_STORAGE_DIR, one file per key. will be replaced with object storage in the future */
@Injectable()
export class PackageStorage {
  private readonly directory: string;

  constructor(config: ConfigService<Env, true>) {
    this.directory = resolve(config.get("PACKAGE_STORAGE_DIR", { infer: true }));
  }

  /** Writes `content` under `key`, replacing any package there; a partial write is never visible under `key`. */
  async save(key: string, content: Readable): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathOf(key);
    const partial = `${path}.${randomUUID()}.partial`;
    try {
      await pipeline(content, createWriteStream(partial));
      await rename(partial, path);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  /** The package stored under `key`, or null when there is none. */
  async open(key: string): Promise<ReadStream | null> {
    const path = this.pathOf(key);
    try {
      await access(path);
    } catch {
      return null;
    }
    return createReadStream(path);
  }

  /** The derived artifact of the package under `key`, or null when it has none. Throws when there is no package. */
  async openArtifact(key: string): Promise<PackageArtifact | null> {
    return this.withPackage(key, async ({ zip, artifact }) => {
      if (!artifact) return null;
      return { format: artifact.manifest.format, content: await zip.openReadStreamPromise(artifact.zipEntry) };
    });
  }

  /** The derived artifact's manifest entry in the package under `key`, or null. Throws as `openArtifact` does. */
  async artifactEntry(key: string): Promise<ManifestArtifact | null> {
    return this.withPackage(key, ({ artifact }) => artifact?.manifest ?? null);
  }

  /**
   * Opens the package under `key` for `use`, with its derived artifact's manifest entry and ZIP entry. Throws when the
   * package is missing or unreadable, or lacks the file its manifest lists.
   */
  private async withPackage<T>(key: string, use: (contents: PackageContents) => T | Promise<T>): Promise<T> {
    const zip = await openPromise(this.pathOf(key), { lazyEntries: true, autoClose: false });
    try {
      const entries = new Map<string, Entry>();
      for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);

      const manifestEntry = entries.get("manifest.json");
      if (!manifestEntry) throw new Error(`Package ${key} has no manifest.json`);
      const manifest = manifestSchema.parse(JSON.parse(await text(await zip.openReadStreamPromise(manifestEntry))));

      const derived = manifest.artifacts.find((candidate) => candidate.role === "derived");
      if (!derived) return await use({ zip, artifact: null });
      const zipEntry = entries.get(derived.path);
      if (!zipEntry) throw new Error(`Package ${key} lists ${derived.path} but doesn't hold it`);
      return await use({ zip, artifact: { manifest: derived, zipEntry } });
    } finally {
      // The file stays open until any stream opened from it has ended.
      zip.close();
    }
  }

  private pathOf(key: string): string {
    return join(this.directory, `${key}.dtccpkg`);
  }
}
