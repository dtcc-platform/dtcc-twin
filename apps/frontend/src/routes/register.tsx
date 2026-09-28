import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { authQueries } from "@/api/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "@/features/auth/register-form";
import { safeRedirect } from "@/features/auth/safe-redirect";

export const Route = createFileRoute("/register")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  // Already logged in: straight on to where they were headed.
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.query({ ...authQueries.me(), staleTime: "static" });
    if (user) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: RegisterPage,
});

function RegisterPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-sm p-8">
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>You are logged in straight away.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm onRegistered={() => void navigate({ href: safeRedirect(search.redirect), replace: true })} />
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          Already registered?&nbsp;
          <Link to="/login" search={search} className="text-foreground underline underline-offset-4">
            Log in
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
