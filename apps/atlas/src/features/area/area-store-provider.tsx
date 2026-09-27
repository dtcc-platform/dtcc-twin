import { type ReactNode, useState } from "react";
import { AreaStoreContext, createAreaStore } from "./area-store";

export function AreaStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createAreaStore(localStorage));

  return <AreaStoreContext value={store}>{children}</AreaStoreContext>;
}
