import { createFileRoute, redirect } from "@tanstack/react-router";
import { authQueries } from "@/api/auth";

/**
 * Every route under _authenticated/ needs a logged-in user; anyone else goes back to the map. In `beforeLoad`,
 * not a rendered <Navigate>, so the page never renders without a user.
 */
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.query({ ...authQueries.me(), staleTime: "static" });
    if (!user) throw redirect({ to: "/" });
    return { user };
  },
});
