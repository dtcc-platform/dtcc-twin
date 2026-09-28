import { createFileRoute, redirect } from "@tanstack/react-router";
import { authQueries } from "@/api/auth";

/**
 * Every route under _authenticated/ needs a logged-in user. In `beforeLoad`, not a rendered <Navigate>:
 * a component reads the location mid-navigation, already /login, and would redirect there forever.
 */
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.query({ ...authQueries.me(), staleTime: "static" });
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } });
    return { user };
  },
});
