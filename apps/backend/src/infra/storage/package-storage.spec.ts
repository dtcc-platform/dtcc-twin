import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipped } from "../../../test/helpers/packages.js";
import type { Env } from "../../config/env.schema.js";
import { PackageStorage } from "./package-storage.js";

describe("PackageStorage.readEntry", () => {
  let directory: string;
  let storage: PackageStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "packages-"));
    const config = { get: () => directory } as unknown as ConfigService<Env, true>;
    storage = new PackageStorage(config);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function store(key: string, files: Record<string, string | Buffer>): Promise<void> {
    await storage.save(key, Readable.from(await zipped(files)));
  }

  it("reads one file out of a stored package", async () => {
    await store("job", { "manifest.json": '{"identity":{}}', "model.pb": Buffer.alloc(1024) });

    expect((await storage.readEntry("job", "manifest.json", 1024))?.toString("utf8")).toBe('{"identity":{}}');
  });

  it("answers null when there is no such package, or no such file in it", async () => {
    await store("job", { "model.pb": Buffer.alloc(16) });

    expect(await storage.readEntry("missing", "manifest.json", 1024)).toBeNull();
    expect(await storage.readEntry("job", "manifest.json", 1024)).toBeNull();
  });

  it("refuses a file larger than the limit before reading it", async () => {
    await store("job", { "manifest.json": "x".repeat(2048) });

    await expect(storage.readEntry("job", "manifest.json", 1024)).rejects.toThrow(/larger than 1024 bytes/);
  });

  it("rejects a stored file that is not a zip", async () => {
    await storage.save("job", Readable.from(Buffer.from("not a zip")));

    await expect(storage.readEntry("job", "manifest.json", 1024)).rejects.toThrow();
  });
});
