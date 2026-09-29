import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";

/** What the panel column on the right of the map can show; one at a time. */
export type RightContent = "bookmarks" | "datasets" | "simulations" | "downloads" | "upload";

/** What the panel column beside the toolbar can show; one at a time. */
export type LeftContent = "layers";

type WorkspaceState = {
  right: RightContent | null;
  left: LeftContent | null;
  actions: {
    setRight: (content: RightContent) => void;
    closeRight: () => void;
    setLeft: (content: LeftContent) => void;
    closeLeft: () => void;
  };
};

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export function createWorkspaceStore() {
  return createStore<WorkspaceState>()((set) => ({
    right: null,
    left: null,
    actions: {
      setRight: (content) => set({ right: content }),
      closeRight: () => set({ right: null }),
      setLeft: (content) => set({ left: content }),
      closeLeft: () => set({ left: null }),
    },
  }));
}

export const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("useWorkspaceStore must be used within a WorkspaceStoreContext provider");
  return useStore(store, selector);
}
