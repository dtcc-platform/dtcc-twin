import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { authQueries } from "@/api/auth";
import { AuthDialog } from "@/features/auth/auth-dialog";
import { authSearchSchema } from "@/features/auth/auth-search";
import { safeRedirect } from "@/features/auth/safe-redirect";
import { Workspace } from "@/features/workspace/workspace";

export const Route = createFileRoute("/")({ validateSearch: authSearchSchema, component: WorkspacePage });

function WorkspacePage() {
  const { auth, redirect } = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useQuery(authQueries.me());

  return (
    <main className="relative h-svh">
      <Workspace />
      <AuthDialog
        // Only for nobody: a logged-in user following an old `?auth=` link just sees the map.
        mode={me.data === null ? auth : undefined}
        onModeChange={(mode) => void navigate({ search: (search) => ({ ...search, auth: mode }), replace: true })}
        onClose={() => void navigate({ search: {}, replace: true })}
        onDone={() => void navigate({ href: safeRedirect(redirect), replace: true })}
      />
    </main>
  );
}
