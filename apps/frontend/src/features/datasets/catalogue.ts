import type { Dataset } from "@repo/contracts";

/** The two catalogue panels: the engine marks a simulation by its data category, and everything else is a Dataset. */
export type CatalogueKind = "datasets" | "simulations";

export function catalogue(datasets: Dataset[], kind: CatalogueKind): Dataset[] {
  return datasets
    .filter((dataset) => (dataset.dataCategory === "simulation") === (kind === "simulations"))
    .toSorted((a, b) => a.title.localeCompare(b.title));
}
