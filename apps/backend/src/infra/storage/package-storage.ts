import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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

  private pathOf(key: string): string {
    return join(this.directory, `${key}.dtccpkg`);
  }
}
