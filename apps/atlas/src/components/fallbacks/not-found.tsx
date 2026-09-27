import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";

/** The router's `defaultNotFoundComponent`: an unknown URL, or a route throwing `notFound()`. */
export function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-start gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">No page matches this address.</p>
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        Back home
      </Link>
    </main>
  );
}
