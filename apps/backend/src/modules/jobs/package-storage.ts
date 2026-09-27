import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Injectable } from "@nestjs/common";

// Relative to the working directory, which pnpm sets to apps/backend; gitignored.
const packagesDir = resolve(".data/packages");

/** Where completed jobs' packages are kept. On local disk for the demo; object storage later. */
@Injectable()
export class PackageStorage {
  async save(jobId: string, archive: Uint8Array): Promise<void> {
    await mkdir(packagesDir, { recursive: true });
    await writeFile(pathOf(jobId), archive);
  }

  read(jobId: string): Promise<Uint8Array> {
    return readFile(pathOf(jobId));
  }
}

function pathOf(jobId: string): string {
  return resolve(packagesDir, `${jobId}.dtccpkg`);
}
