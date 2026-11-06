import type { Dataset } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { datasetOfTool, datasetTool } from "./chat-tools.js";

const trees: Dataset = {
  name: "trees",
  title: "Trees",
  description: "Tree locations derived from point cloud vegetation.",
  dataCategory: "derived",
  resultKind: "tree_collection",
  argsSchema: {
    type: "object",
    title: "TreeArgs",
    properties: {
      bounds: { type: "array", items: { type: "number" } },
      tree_type: { enum: ["urban", "mixed"], default: "urban" },
      format: { enum: ["tif", "gpkg"], default: null },
    },
    required: ["bounds", "tree_type"],
    additionalProperties: false,
  },
  timeoutHint: null,
};

describe("datasetTool", () => {
  it("offers a Dataset as a tool named after it, described by Core", () => {
    const tool = datasetTool(trees);

    expect(tool?.name).toBe("run_trees");
    expect(tool?.description).toContain("Trees. Tree locations derived from point cloud vegetation.");
  });

  // The app adds the selected area's bounds, and the engine always delivers a package, so the model sets neither.
  it("takes the Dataset's parameters without bounds and format", () => {
    expect(datasetTool(trees)?.input_schema).toEqual({
      type: "object",
      title: "TreeArgs",
      properties: { tree_type: { enum: ["urban", "mixed"], default: "urban" } },
      required: ["tree_type"],
      additionalProperties: false,
    });
  });

  it("says how long the Dataset may take when Core gives a hint", () => {
    expect(datasetTool({ ...trees, timeoutHint: 300 })?.description).toContain("300 seconds");
  });

  it("leaves out a Dataset whose name is too long for a tool", () => {
    expect(datasetTool({ ...trees, name: "a".repeat(61) })).toBeNull();
  });
});

describe("datasetOfTool", () => {
  it("names the Dataset a tool runs, and nothing for any other tool", () => {
    expect(datasetOfTool("run_trees")).toBe("trees");
    expect(datasetOfTool("get_job")).toBeNull();
  });
});
