import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { authMutations, authQueries } from "@/api/auth";
import { Button } from "@/components/ui/button";

const link = "text-muted-foreground hover:text-foreground [&.active]:text-foreground";

export function SiteHeader() {
  const me = useQuery(authQueries.me());
  const logout = useMutation(authMutations.logout());
  const navigate = useNavigate();

  // Home is public, so leaving for it also takes the user off any page that needs a login.
  function logOut() {
    logout.mutate(undefined, { onSuccess: () => void navigate({ to: "/" }) });
  }

  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-8 py-3 text-sm">
        <Link to="/" className="font-semibold">
          DTCC Twin
        </Link>
        {me.data ? (
          <>
            <Link to="/items" className={link}>
              Items
            </Link>
            <Link to="/profile" className={link}>
              Profile
            </Link>
            <span className="ml-auto text-muted-foreground">Logged in as {me.data.name}</span>
            <Button variant="outline" size="sm" disabled={logout.isPending} onClick={logOut}>
              Log out
            </Button>
          </>
        ) : (
          <span className="ml-auto flex gap-4">
            <Link to="/login" className={link}>
              Log in
            </Link>
            <Link to="/register" className={link}>
              Register
            </Link>
          </span>
        )}
      </nav>
    </header>
  );
}
