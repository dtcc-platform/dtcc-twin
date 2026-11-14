import type { Dataset } from "@repo/contracts";
import { z } from "zod";
import { humanize } from "./dataset-fields.ts";

/** A format the job's product offers, with why the job's parameters rule it out, or null when they don't. */
export type FormatChoice = { format: string; unavailable: string | null };

// In the order the form prefers them.
const mapFormats = ["png", "geojson"];

const argsSchemaSchema = z.object({
  properties: z
    .record(z.string(), z.object({ title: z.string().optional(), default: z.unknown().optional() }))
    .optional(),
});

/**
 * The formats the product in the job's parameters offers, those the map draws first. The parameters leave out values
 * at their default, as `jobParameters` builds them.
 */
export function formatChoices(
  dataset: Pick<Dataset, "argsSchema" | "artifactFormats">,
  parameters: Record<string, unknown>,
): FormatChoice[] {
  const properties = argsSchemaSchema.safeParse(dataset.argsSchema).data?.properties ?? {};
  const valueOf = (name: string): unknown => (name in parameters ? parameters[name] : properties[name]?.default);

  const product = valueOf("product") ?? null;
  const formats = dataset.artifactFormats.find((entry) => entry.product === product)?.formats ?? [];
  const choices = formats.map(({ format, requires }): FormatChoice => {
    const unmet = Object.entries(requires).find(([name, value]) => !isDeepEqual(valueOf(name), value));
    if (!unmet) return { format, unavailable: null };
    const [name, value] = unmet;
    const shown = typeof value === "string" ? value : JSON.stringify(value);
    return { format, unavailable: `Needs ${properties[name]?.title ?? humanize(name)} = ${shown}` };
  });
  return choices.toSorted((a, b) => rank(a.format) - rank(b.format));
}

/** The format the job sends: the chosen one while it's available, or else the first available one. */
export function jobFormat(choices: FormatChoice[], chosen: string | null): string | null {
  const available = choices.filter((choice) => choice.unavailable === null).map((choice) => choice.format);
  if (chosen !== null && available.includes(chosen)) return chosen;
  return available[0] ?? null;
}

function rank(format: string): number {
  const index = mapFormats.indexOf(format);
  return index === -1 ? mapFormats.length : index;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
