import type { JobArtifact } from "@repo/contracts";
import { humanize } from "@/lib/humanize";

type Legend = NonNullable<JobArtifact["legend"]>;

const valueFormat = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });

/** What a legend's colors measure, such as "Speed (m/s)". */
export function legendTitle({ field, unit }: Pick<Legend, "field" | "unit">): string {
  if (field === null) return unit ?? "";
  return unit === null ? humanize(field) : `${humanize(field)} (${unit})`;
}

export function legendValue(value: number): string {
  return valueFormat.format(value);
}
