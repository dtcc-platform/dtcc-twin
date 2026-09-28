export const refreshPath = "auth/refresh";

// These answer 401 for reasons a refresh cannot fix: a wrong password, or no session to refresh.
const authRoutes = /(^|\/)auth\/(login|register|refresh|logout)$/;

/** Whether a 401 from this path is worth a refresh and one retry. */
export function canRefreshAfter(path: string): boolean {
  return !authRoutes.test(path.split("?")[0] ?? "");
}

/**
 * Requests failing together share one refresh: five expired queries send one `POST /auth/refresh`.
 * Resolves to whether it worked; never rejects.
 */
export function sharedRefresh(refresh: () => Promise<unknown>): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;

  return () => {
    pending ??= refresh()
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
