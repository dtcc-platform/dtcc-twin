import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";

type CounterState = {
  count: number;
  actions: {
    increment: () => void;
    decrement: () => void;
    reset: () => void;
  };
};

export type CounterStore = ReturnType<typeof createCounterStore>;

export function createCounterStore(initialCount: number) {
  return createStore<CounterState>()((set) => ({
    count: initialCount,
    actions: {
      increment: () => set((state) => ({ count: state.count + 1 })),
      decrement: () => set((state) => ({ count: state.count - 1 })),
      reset: () => set({ count: initialCount }),
    },
  }));
}

export const CounterStoreContext = createContext<CounterStore | null>(null);

function useCounterStore<T>(selector: (state: CounterState) => T): T {
  const store = useContext(CounterStoreContext);
  if (!store) throw new Error("Missing CounterStoreProvider");
  return useStore(store, selector);
}

export const useCount = () => useCounterStore((state) => state.count);

export const useCounterActions = () => useCounterStore((state) => state.actions);
