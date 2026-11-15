import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";

/** The colors results take on the map, in the order they're added. */
export const layerColors = ["#e11d48", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2"] as const;

/** A job's result on the map. */
export type ResultLayer = { jobId: string; title: string; color: string };

type LayersState = {
  /** In the order they were added. */
  layers: ResultLayer[];
  actions: {
    add: (layer: Omit<ResultLayer, "color">) => void;
    remove: (jobId: string) => void;
  };
};

export type LayersStore = ReturnType<typeof createLayersStore>;

export function createLayersStore() {
  // Every layer ever added, so each keeps its color while others are removed.
  let added = 0;

  return createStore<LayersState>()((set, get) => ({
    layers: [],
    actions: {
      add: (layer) => {
        if (get().layers.some((existing) => existing.jobId === layer.jobId)) return;
        const color = layerColors[added % layerColors.length] ?? layerColors[0];
        added += 1;
        set({ layers: [...get().layers, { ...layer, color }] });
      },
      remove: (jobId) => set({ layers: get().layers.filter((layer) => layer.jobId !== jobId) }),
    },
  }));
}

export const LayersStoreContext = createContext<LayersStore | null>(null);

export function useLayersStore<T>(selector: (state: LayersState) => T): T {
  const store = useContext(LayersStoreContext);
  if (!store) throw new Error("useLayersStore must be used within a LayersStoreContext provider");
  return useStore(store, selector);
}
