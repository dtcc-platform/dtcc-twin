import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { openPromise, type Entry } from "yauzl";
import { z } from "zod";
import type { Env } from "../../config/env.schema.js";

// The part of a package's manifest.json, Core's dtcc-dataset-manifest-v3, that the backend reads.
const manifestSchema = z.object({
  artifacts: z.array(z.object({ path: z.string(), role: z.string(), format: z.string().regex(/^[a-z0-9]+$/) })),
});

/** The extra file Core added to a package: its format, such as `geojson`, and its content. */
export type PackageArtifact = { format: string; content: Readable };

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
    const zip = await openPromise(this.pathOf(key), { lazyEntries: true, autoClose: false });
    try {
      const entries = new Map<string, Entry>();
      for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);

      const manifestEntry = entries.get("manifest.json");
      if (!manifestEntry) throw new Error(`Package ${key} has no manifest.json`);
      const manifest = manifestSchema.parse(JSON.parse(await text(await zip.openReadStreamPromise(manifestEntry))));

      const artifact = manifest.artifacts.find((candidate) => candidate.role === "derived");
      if (!artifact) return null;
      const entry = entries.get(artifact.path);
      if (!entry) throw new Error(`Package ${key} lists ${artifact.path} but doesn't hold it`);
      return { format: artifact.format, content: await zip.openReadStreamPromise(entry) };
    } finally {
      // The file stays open until the artifact's stream has ended.
      zip.close();
    }
  }

  private pathOf(key: string): string {
    return join(this.directory, `${key}.dtccpkg`);
  }
}
