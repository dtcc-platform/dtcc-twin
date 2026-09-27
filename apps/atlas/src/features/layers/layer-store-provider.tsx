import { type ReactNode, useState } from "react";
import { createLayerStore, LayerStoreContext } from "./layer-store";

export function LayerStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createLayerStore(localStorage));

  return <LayerStoreContext value={store}>{children}</LayerStoreContext>;
}
