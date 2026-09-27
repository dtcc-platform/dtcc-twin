import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { reorder } from "./layers";

export type LayerSettings = { visible: boolean; opacity: number };

const defaultSettings: LayerSettings = { visible: true, opacity: 1 };

type LayerState = {
  /** Per job id; a layer without an entry uses the defaults. */
  settings: Record<string, LayerSettings>;
  /** Job ids, top first, as last arranged; see `arrangeLayers`. */
  order: string[];
  /** Job ids taken off their area's layers. */
  removed: string[];
  actions: {
    toggleVisible: (id: string) => void;
    setOpacity: (id: string, opacity: number) => void;
    move: (areaLayerIds: string[], id: string, direction: "up" | "down") => void;
    remove: (id: string) => void;
  };
};

export type LayerStore = ReturnType<typeof createLayerStore>;

export function createLayerStore(storage: StateStorage) {
  return createStore<LayerState>()(
    persist(
      (set, get) => {
        function change(id: string, changes: Partial<LayerSettings>) {
          const { settings } = get();
          set({ settings: { ...settings, [id]: { ...layerSettings(get(), id), ...changes } } });
        }

        return {
          settings: {},
          order: [],
          removed: [],
          actions: {
            toggleVisible: (id) => {
              change(id, { visible: !layerSettings(get(), id).visible });
            },
            setOpacity: (id, opacity) => {
              change(id, { opacity });
            },
            move: (areaLayerIds, id, direction) => {
              set({ order: reorder(get().order, areaLayerIds, id, direction) });
            },
            remove: (id) => {
              set({ removed: [...get().removed, id] });
            },
          },
        };
      },
      {
        name: "atlas.layers",
        storage: createJSONStorage(() => storage),
        partialize: ({ settings, order, removed }) => ({ settings, order, removed }),
      },
    ),
  );
}

export function layerSettings(state: Pick<LayerState, "settings">, id: string): LayerSettings {
  return state.settings[id] ?? defaultSettings;
}

export const LayerStoreContext = createContext<LayerStore | null>(null);

function useLayerStore<T>(selector: (state: LayerState) => T): T {
  const store = useContext(LayerStoreContext);
  if (!store) throw new Error("Missing LayerStoreProvider");
  return useStore(store, selector);
}

export const useLayerSettings = (id: string) => useLayerStore((state) => layerSettings(state, id));

export const useLayerOrder = () => useLayerStore((state) => state.order);

export const useRemovedLayers = () => useLayerStore((state) => state.removed);

export const useLayerActions = () => useLayerStore((state) => state.actions);
