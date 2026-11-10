import { cityReader } from "./city.reader.js";
import type { DtccModelFile } from "./package-reader.js";
export type Reader = (model: DtccModelFile) => Record<string, unknown>;
export const READERS: Record<string, Reader> = { city: cityReader };
