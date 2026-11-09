import type { ReadStream } from "node:fs";
import protobuf from "protobufjs";
import yauzl from "yauzl";
import { z } from "zod";

export type DtccObject = { kind: string; children?: DtccObject[] };
export type DtccModelFile = { format: string; version: number; object?: DtccObject };
export type PackageContents = {
  presentation: { headline?: unknown; summary?: unknown; warnings?: unknown };
  model: DtccModelFile | null;
};
export class PackageReadError extends Error {}
const schema = protobuf.loadSync(new URL("./dtcc.proto", import.meta.url).pathname);
const modelType = schema.lookupType("DTCC.ModelFile");
const kinds = schema.lookupEnum("DTCC.Object.Kind");
const MANIFEST = "manifest.json";
const MODEL = "artifacts/model.dtcc";
const MAX_MANIFEST_BYTES = 1024 * 1024;
// The fields of a decoded `DTCC.ModelFile` that readers use; enum fields decode to numbers.
type DecodedObject = { kind: number; children: DecodedObject[] };
type DecodedModel = { format: string; version: number; object: DecodedObject | null };
let pending: Promise<unknown> = Promise.resolve();

/**
 * Reads a stored package's manifest and, when asked, its model; one package at a time per process, to bound memory.
 * Only those members are inflated, from the file itself: the archive is never read into memory.
 */
export function readPackage(source: ReadStream, maxModelBytes: number, withModel: boolean): Promise<PackageContents> {
  // Only the file's path is needed; the stream JobsService opened is closed unread.
  const file = String(source.path);
  source.destroy();
  const result = pending.then(async () => {
    const members = await extract(
      file,
      withModel ? { [MANIFEST]: MAX_MANIFEST_BYTES, [MODEL]: maxModelBytes } : { [MANIFEST]: MAX_MANIFEST_BYTES },
    );
    const presentation = readPresentation(members.get(MANIFEST));
    if (!withModel) return { presentation, model: null };
    const model = members.get(MODEL);
    if (!model) throw new PackageReadError(`Missing ${MODEL}`);
    members.clear();
    return { presentation, model: decodeModel(model) };
  });
  pending = result.catch(() => undefined);
  return result;
}

export function isKind(object: DtccObject | undefined, name: "CITY" | "BUILDING"): boolean {
  return kinds.values[name] !== undefined && object?.kind === name;
}

async function extract(file: string, limits: Record<string, number>): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) {
        reject(new PackageReadError("The package is not a valid archive", { cause: error }));
        return;
      }
      const members = new Map<string, Buffer>();
      const fail = (reason: unknown): void => {
        zip.close();
        reject(
          reason instanceof PackageReadError ? reason : new PackageReadError("Invalid archive", { cause: reason }),
        );
      };
      zip.on("error", fail);
      zip.on("end", () => {
        resolve(members);
      });
      zip.on("entry", (entry: yauzl.Entry) => {
        const limit = limits[entry.fileName];
        if (limit === undefined || members.has(entry.fileName)) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > limit) {
          fail(new PackageReadError(`${entry.fileName} exceeds its size limit`));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }
          // Inflate straight into one buffer of the declared size; yauzl rejects a member that differs from it.
          const member = Buffer.allocUnsafe(entry.uncompressedSize);
          let offset = 0;
          stream.on("data", (chunk: Buffer) => {
            if (offset + chunk.length > member.length) {
              stream.destroy(new PackageReadError(`${entry.fileName} is larger than declared`));
              return;
            }
            offset += chunk.copy(member, offset);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            members.set(entry.fileName, member);
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function readPresentation(manifest: Buffer | undefined): PackageContents["presentation"] {
  if (!manifest) throw new PackageReadError(`Missing ${MANIFEST}`);
  try {
    const parsed = z
      .object({
        presentation: z.object({ headline: z.unknown().optional(), summary: z.unknown().optional() }).optional(),
        warnings: z.unknown().optional(),
      })
      .parse(JSON.parse(manifest.toString("utf8")));
    return { ...parsed.presentation, warnings: parsed.warnings };
  } catch (error) {
    throw new PackageReadError("The manifest could not be read", { cause: error });
  }
}

// Reads only what readers use from the decoded message: `toObject` would copy every geometry into new JS objects.
function decodeModel(member: Buffer): DtccModelFile {
  let decoded: DecodedModel;
  try {
    decoded = modelType.decode(member) as unknown as DecodedModel;
  } catch (error) {
    throw new PackageReadError("The model could not be decoded", { cause: error });
  }
  if (decoded.format !== "dtcc-model" || decoded.version !== 6)
    throw new PackageReadError("Unsupported model format or version");
  const root = decoded.object;
  return {
    format: decoded.format,
    version: decoded.version,
    ...(root && {
      object: { kind: kindName(root.kind), children: root.children.map((child) => ({ kind: kindName(child.kind) })) },
    }),
  };
}

function kindName(kind: number): string {
  return kinds.valuesById[kind] ?? "UNSPECIFIED";
}
