import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { authQueries } from "@/api/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/login-form";
import { safeRedirect } from "@/features/auth/safe-redirect";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.query({ ...authQueries.me(), staleTime: "static" });
    if (user) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-sm p-8">
      <Card>
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>With your email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm onLoggedIn={() => void navigate({ href: safeRedirect(search.redirect), replace: true })} />
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          No account yet?&nbsp;
          <Link to="/register" search={search} className="text-foreground underline underline-offset-4">
            Register
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
