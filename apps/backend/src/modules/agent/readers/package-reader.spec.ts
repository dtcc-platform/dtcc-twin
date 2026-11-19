import { createReadStream, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import yauzl from "yauzl";
import { readPackage, PackageReadError } from "./package-reader.js";
import { cityReader } from "./city.reader.js";

const fixture = new URL("../../../../test/fixtures/city-small.dtccpkg", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "package-reader-"));
// A stored package as JobsService hands it over: a read stream of a file.
function stored(name: string, bytes: Buffer) {
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return createReadStream(path);
}
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
      readPackage(stored("corrupt.dtccpkg", Buffer.from("not a zip")), 512 * 1024 * 1024, true),
    ).rejects.toBeInstanceOf(PackageReadError);
  });
  it("rejects an archive without the model member", async () => {
    const emptyZip = Buffer.alloc(22);
    emptyZip.writeUInt32LE(0x06054b50);
    await expect(readPackage(stored("empty.dtccpkg", emptyZip), 512 * 1024 * 1024, true)).rejects.toBeInstanceOf(
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
  it("reads the stored file in place, never streaming the whole archive into memory", async () => {
    const source = createReadStream(fixture);
    const { model } = await readPackage(source, 512 * 1024 * 1024, true);
    if (!model) throw new Error("Missing model");
    expect(cityReader(model)).toEqual({ buildings: 21 });
    expect(source.bytesRead).toBe(0);
  });
  it("opens at most one archive at a time", async () => {
    const open = vi.spyOn(yauzl, "open");
    const a = readPackage(createReadStream(fixture), 512 * 1024 * 1024, true);
    const b = readPackage(createReadStream(fixture), 512 * 1024 * 1024, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(open).toHaveBeenCalledTimes(1);
    await a;
    await b;
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });
});
