import type { Dataset } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { catalogue } from "./catalogue.ts";

function dataset(name: string, title: string, dataCategory: string): Dataset {
  return { name, title, description: "", dataCategory, resultKind: "mesh", argsSchema: {}, timeoutHint: null };
}

// The engine's list, sorted by name as the backend sends it.
const datasets = [
  dataset("buildings", "LoD1 Buildings", "derived"),
  dataset("buses", "Buses", "raw"),
  dataset("smoke", "Smoke", "synthetic"),
  dataset("traffic_simulation", "Static Traffic Assignment", "simulation"),
  dataset("urban_heat_simulation", "Urban Heat Simulation", "simulation"),
  dataset("weather", "Weather Observations", "raw"),
];

describe("catalogue", () => {
  it("lists the simulations, by title", () => {
    expect(catalogue(datasets, "simulations").map((item) => item.title)).toEqual([
      "Static Traffic Assignment",
      "Urban Heat Simulation",
    ]);
  });

  it("lists every other Dataset, synthetic ones included, by title", () => {
    expect(catalogue(datasets, "datasets").map((item) => item.title)).toEqual([
      "Buses",
      "LoD1 Buildings",
      "Smoke",
      "Weather Observations",
    ]);
  });
});
