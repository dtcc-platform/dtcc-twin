import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { openPromise, type Entry, type ZipFile } from "yauzl";
import type { Env } from "../../config/env.schema.js";

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

  /**
   * One file out of the zip stored under `key`, such as a package's `manifest.json`, or null when there is no package or
   * no such file. Reads only that file; throws if it is larger than `maxBytes` or the stored file is not a zip.
   */
  async readEntry(key: string, name: string, maxBytes: number): Promise<Buffer | null> {
    const path = this.pathOf(key);
    try {
      await access(path);
    } catch {
      return null;
    }

    const zip = await openPromise(path, { lazyEntries: true, autoClose: false });
    try {
      const entry = await findEntry(zip, name);
      if (!entry) return null;
      if (entry.uncompressedSize > maxBytes)
        throw new Error(`${name} in package ${key} is larger than ${String(maxBytes)} bytes`);
      return await buffer(await zip.openReadStreamPromise(entry));
    } finally {
      zip.close();
    }
  }

  private pathOf(key: string): string {
    return join(this.directory, `${key}.dtccpkg`);
  }
}

// The central directory lists every entry, so only the named file's bytes are read.
function findEntry(zip: ZipFile, name: string): Promise<Entry | null> {
  return new Promise((settle, fail) => {
    zip.on("entry", (entry: Entry) => {
      if (entry.fileName === name) settle(entry);
      else zip.readEntry();
    });
    zip.on("end", () => {
      settle(null);
    });
    zip.on("error", fail);
    zip.readEntry();
  });
}
