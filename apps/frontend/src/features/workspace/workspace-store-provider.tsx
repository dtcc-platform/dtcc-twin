import { type ReactNode, useState } from "react";
import { WorkspaceStoreContext, createWorkspaceStore } from "./workspace-store.ts";

export function WorkspaceStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createWorkspaceStore);

  return <WorkspaceStoreContext value={store}>{children}</WorkspaceStoreContext>;
}
