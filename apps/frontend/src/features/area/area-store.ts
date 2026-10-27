import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import type { Area } from "./area";

export type DrawingStep = "first-corner" | "opposite-corner";

type AreaState = {
  area: Area | null;
  drawing: DrawingStep | null;
  /** The box as it is being drawn, moved or resized, before it becomes the area. */
  preview: Area | null;
  actions: {
    startDrawing: () => void;
    placeFirstCorner: () => void;
    cancelDrawing: () => void;
    setPreview: (preview: Area | null) => void;
    setArea: (area: Area) => void;
    clearArea: () => void;
  };
};

export type AreaStore = ReturnType<typeof createAreaStore>;

export function createAreaStore() {
  return createStore<AreaState>()((set, get) => ({
    area: null,
    drawing: null,
    preview: null,
    actions: {
      startDrawing: () => set({ area: null, drawing: "first-corner", preview: null }),
      placeFirstCorner: () => {
        if (get().drawing) set({ drawing: "opposite-corner" });
      },
      cancelDrawing: () => set({ drawing: null, preview: null }),
      setPreview: (preview) => set({ preview }),
      setArea: (area) => set({ area, drawing: null, preview: null }),
      clearArea: () => set({ area: null, drawing: null, preview: null }),
    },
  }));
}

export const AreaStoreContext = createContext<AreaStore | null>(null);

export function useAreaStore<T>(selector: (state: AreaState) => T): T {
  const store = useContext(AreaStoreContext);
  if (!store) throw new Error("useAreaStore must be used within an AreaStoreContext provider");
  return useStore(store, selector);
}
