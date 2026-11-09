import { isKind, PackageReadError, type DtccModelFile } from "./package-reader.js";

export function cityReader(model: DtccModelFile): Record<string, unknown> {
  if (!isKind(model.object, "CITY")) throw new PackageReadError("Expected a CITY root");
  return { buildings: (model.object?.children ?? []).filter((child) => isKind(child, "BUILDING")).length };
}
