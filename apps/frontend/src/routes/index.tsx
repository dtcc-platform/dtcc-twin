import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">DTCC Twin</h1>
      <p className="text-muted-foreground">
        Admins can try the backend in the{" "}
        <Link to="/dev/playground" className="font-medium text-foreground underline underline-offset-4">
          API playground
        </Link>
        .
      </p>
      <p className="text-muted-foreground">
        They can also see{" "}
        <Link to="/dev/counters" className="font-medium text-foreground underline underline-offset-4">
          two counters with localized Zustand stores
        </Link>
        .
      </p>
    </main>
  );
}
