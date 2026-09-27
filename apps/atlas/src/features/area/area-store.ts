import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { Area } from "./area";

export type SavedArea = { id: string; name: string; area: Area };

type AreaState = {
  /** Every area drawn, newest first; kept in storage. */
  areas: SavedArea[];
  /** The area being worked on, whose layers the sidebar shows. */
  selectedId: string | null;
  /** Whether the map is waiting for a new area to be drawn. */
  drawing: boolean;
  actions: {
    startDrawing: () => void;
    cancelDrawing: () => void;
    addDrawnArea: (area: Area) => void;
    select: (id: string) => void;
    unselect: () => void;
    updateSelectedArea: (area: Area) => void;
    rename: (id: string, name: string) => void;
    deleteArea: (id: string) => void;
  };
};

export type AreaStore = ReturnType<typeof createAreaStore>;

export function createAreaStore(storage: StateStorage) {
  return createStore<AreaState>()(
    persist(
      (set, get) => ({
        areas: [],
        selectedId: null,
        drawing: false,
        actions: {
          startDrawing: () => set({ drawing: true, selectedId: null }),
          cancelDrawing: () => set({ drawing: false }),
          addDrawnArea: (area) => {
            const entry = { id: crypto.randomUUID(), name: `Area ${new Date().toLocaleString()}`, area };
            set({ areas: [entry, ...get().areas], selectedId: entry.id, drawing: false });
          },
          select: (id) => set({ selectedId: id }),
          unselect: () => set({ selectedId: null }),
          updateSelectedArea: (area) => {
            const { areas, selectedId } = get();
            set({ areas: areas.map((entry) => (entry.id === selectedId ? { ...entry, area } : entry)) });
          },
          rename: (id, name) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            set({ areas: get().areas.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry)) });
          },
          deleteArea: (id) => {
            const { areas, selectedId } = get();
            set({ areas: areas.filter((entry) => entry.id !== id), selectedId: selectedId === id ? null : selectedId });
          },
        },
      }),
      {
        name: "atlas.areas",
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ areas: state.areas }),
      },
    ),
  );
}

export function selectedArea(state: Pick<AreaState, "areas" | "selectedId">): SavedArea | null {
  return state.areas.find((entry) => entry.id === state.selectedId) ?? null;
}

export const AreaStoreContext = createContext<AreaStore | null>(null);

/** The store itself, for code that syncs it with something outside React, such as the drawing on the map. */
export function useAreaStoreApi(): AreaStore {
  const store = useContext(AreaStoreContext);
  if (!store) throw new Error("Missing AreaStoreProvider");
  return store;
}

function useAreaStore<T>(selector: (state: AreaState) => T): T {
  return useStore(useAreaStoreApi(), selector);
}

export const useAreas = () => useAreaStore((state) => state.areas);

export const useSelectedArea = () => useAreaStore(selectedArea);

export const useDrawing = () => useAreaStore((state) => state.drawing);

export const useAreaActions = () => useAreaStore((state) => state.actions);
