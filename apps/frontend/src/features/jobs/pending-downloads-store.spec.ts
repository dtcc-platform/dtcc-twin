import { describe, expect, it } from "vitest";
import { createPendingDownloadsStore } from "./pending-downloads-store.ts";

describe("createPendingDownloadsStore", () => {
  it("starts with nothing to download", () => {
    expect(createPendingDownloadsStore().getState().downloads).toEqual([]);
  });

  it("waits for each job once", () => {
    const store = createPendingDownloadsStore();
    const { add } = store.getState().actions;

    add({ jobId: "a", title: "Roads" });
    add({ jobId: "a", title: "Roads" });
    add({ jobId: "b", title: "Trees" });

    expect(store.getState().downloads).toEqual([
      { jobId: "a", title: "Roads" },
      { jobId: "b", title: "Trees" },
    ]);
  });

  it("stops waiting for a job", () => {
    const store = createPendingDownloadsStore();
    const { add, remove } = store.getState().actions;

    add({ jobId: "a", title: "Roads" });
    add({ jobId: "b", title: "Trees" });
    remove("a");

    expect(store.getState().downloads).toEqual([{ jobId: "b", title: "Trees" }]);
  });
});
