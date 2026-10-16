import { createFileRoute, redirect } from "@tanstack/react-router";
import { authQueries } from "@/api/auth";

/**
 * Every route under _authenticated/ needs a logged-in user; anyone else gets the login dialog on the map,
 * which brings them back here. In `beforeLoad`, not a rendered <Navigate>, so the page never renders without a user.
 */
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.query({ ...authQueries.me(), staleTime: "static" });
    if (!user) throw redirect({ to: "/", search: { auth: "login", redirect: location.href } });
    return { user };
  },
});
