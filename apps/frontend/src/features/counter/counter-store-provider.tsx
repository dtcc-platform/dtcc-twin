import { type ReactNode, useState } from "react";
import { CounterStoreContext, createCounterStore } from "./counter-store.ts";

type CounterStoreProviderProps = {
  initialCount: number;
  children: ReactNode;
};

export function CounterStoreProvider({ initialCount, children }: CounterStoreProviderProps) {
  // Later initialCount changes are ignored, like useState's initial value; remount with a `key` to start over.
  const [store] = useState(() => createCounterStore(initialCount));

  return <CounterStoreContext value={store}>{children}</CounterStoreContext>;
}
