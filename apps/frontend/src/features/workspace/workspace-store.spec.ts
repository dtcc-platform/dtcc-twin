import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./workspace-store.ts";

describe("createWorkspaceStore", () => {
  it("starts with both panel columns empty", () => {
    const store = createWorkspaceStore();

    expect(store.getState().right).toBeNull();
    expect(store.getState().left).toBeNull();
  });

  it("shows content on the right and replaces whatever was there", () => {
    const store = createWorkspaceStore();
    const { setRight } = store.getState().actions;

    setRight("datasets");
    setRight("downloads");

    expect(store.getState().right).toBe("downloads");
  });

  it("closes the right column without touching the left", () => {
    const store = createWorkspaceStore();
    const { setRight, closeRight, setLeft } = store.getState().actions;

    setLeft("layers");
    setRight("bookmarks");
    closeRight();

    expect(store.getState().right).toBeNull();
    expect(store.getState().left).toBe("layers");
  });

  it("opens and closes the left column without touching the right", () => {
    const store = createWorkspaceStore();
    const { setRight, setLeft, closeLeft } = store.getState().actions;

    setRight("datasets");
    setLeft("layers");

    expect(store.getState().left).toBe("layers");
    expect(store.getState().right).toBe("datasets");

    closeLeft();

    expect(store.getState().left).toBeNull();
    expect(store.getState().right).toBe("datasets");
  });

  it("empties both columns when each is closed", () => {
    const store = createWorkspaceStore();
    const { setRight, closeRight, setLeft, closeLeft } = store.getState().actions;

    setRight("upload");
    setLeft("layers");
    closeRight();
    closeLeft();

    expect(store.getState().right).toBeNull();
    expect(store.getState().left).toBeNull();
  });
});
