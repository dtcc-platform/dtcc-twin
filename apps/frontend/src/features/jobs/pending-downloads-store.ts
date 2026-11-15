import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";

/** A job whose file downloads once it has completed. */
export type PendingDownload = { jobId: string; title: string };

type PendingDownloadsState = {
  downloads: PendingDownload[];
  actions: { add: (download: PendingDownload) => void; remove: (jobId: string) => void };
};

export type PendingDownloadsStore = ReturnType<typeof createPendingDownloadsStore>;

export function createPendingDownloadsStore() {
  return createStore<PendingDownloadsState>()((set, get) => ({
    downloads: [],
    actions: {
      add: (download) => {
        if (get().downloads.some((pending) => pending.jobId === download.jobId)) return;
        set({ downloads: [...get().downloads, download] });
      },
      remove: (jobId) => set({ downloads: get().downloads.filter((pending) => pending.jobId !== jobId) }),
    },
  }));
}

export const PendingDownloadsStoreContext = createContext<PendingDownloadsStore | null>(null);

export function usePendingDownloadsStore<T>(selector: (state: PendingDownloadsState) => T): T {
  const store = useContext(PendingDownloadsStoreContext);
  if (!store) throw new Error("usePendingDownloadsStore must be used within a PendingDownloadsStoreContext provider");
  return useStore(store, selector);
}
