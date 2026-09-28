import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";

/** The router's `defaultErrorComponent`: a route's `beforeLoad`, loader or render threw. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "Unknown error";

  // Either half may hold the failure: `reset` clears a render error, `invalidate` re-runs the route's data.
  function retry() {
    reset();
    void router.invalidate();
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-start gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-destructive">{message}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
        <Link to="/" className={buttonVariants({ variant: "ghost" })}>
          Back home
        </Link>
      </div>
    </main>
  );
}
