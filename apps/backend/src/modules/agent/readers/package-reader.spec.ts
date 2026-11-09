import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readPackage, PackageReadError } from "./package-reader.js";
import { cityReader } from "./city.reader.js";

const fixture = new URL("../../../../test/fixtures/city-small.dtccpkg", import.meta.url);
describe("package reader", () => {
  it("reads the manifest's presentation and counts the 21 direct buildings in one pass", async () => {
    const { presentation, model } = await readPackage(createReadStream(fixture), 512 * 1024 * 1024, true);
    expect(presentation).toEqual({
      headline: "Terrain and LoD1 City Model",
      summary: expect.stringContaining("DTCC city model") as unknown,
      warnings: [],
    });
    if (!model) throw new Error("Missing model");
    expect(cityReader(model)).toEqual({ buildings: 21 });
  });
  it("reads only the manifest when no model is wanted", async () => {
    expect((await readPackage(createReadStream(fixture), 1_000, false)).model).toBeNull();
  });
  it("rejects a corrupt archive", async () => {
    await expect(
      readPackage(Readable.from([Buffer.from("not a zip")]), 512 * 1024 * 1024, true),
    ).rejects.toBeInstanceOf(PackageReadError);
  });
  it("rejects an archive without the model member", async () => {
    const emptyZip = Buffer.alloc(22);
    emptyZip.writeUInt32LE(0x06054b50);
    await expect(readPackage(Readable.from([emptyZip]), 512 * 1024 * 1024, true)).rejects.toBeInstanceOf(
      PackageReadError,
    );
  });
  it("refuses an oversized model before decoding", async () => {
    await expect(readPackage(createReadStream(fixture), 1_000_000, true)).rejects.toBeInstanceOf(PackageReadError);
  });
  it("refuses a non-city root", () => {
    expect(() => cityReader({ format: "dtcc-model", version: 6, object: { kind: "BUILDING", children: [] } })).toThrow(
      PackageReadError,
    );
  });
  it("consumes at most one archive at a time", async () => {
    let consumed = false;
    let finish: (chunk: Buffer) => void = () => undefined;
    const first = Readable.from(
      (async function* () {
        yield await new Promise<Buffer>((resolve) => {
          finish = resolve;
        });
      })(),
    );
    const second = Readable.from(
      (function* () {
        consumed = true;
        yield Buffer.from("invalid");
      })(),
    );
    const a = readPackage(first, 1_000_000, true).catch((error: unknown) => error);
    const b = readPackage(second, 1_000_000, true).catch((error: unknown) => error);
    await new Promise((resolve) => setImmediate(resolve));
    expect(consumed).toBe(false);
    finish(Buffer.from("invalid"));
    expect(await a).toBeInstanceOf(PackageReadError);
    expect(await b).toBeInstanceOf(PackageReadError);
    expect(consumed).toBe(true);
  });
});
