import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Counter } from "@/features/counter/counter";

export const Route = createFileRoute("/_authenticated/dev/counters")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") throw redirect({ to: "/" });
  },
  component: CountersPage,
});

function CountersPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link to="/" className="text-sm underline underline-offset-4">
        ← Home
      </Link>
      <h1 className="my-4 text-4xl font-semibold tracking-tight">Localized Zustand stores</h1>
      <p className="text-muted-foreground">Each counter has its own store, so changing one leaves the other alone.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Counter title="Starts at 0" initialCount={0} />
        <Counter title="Starts at 10" initialCount={10} />
      </div>
    </main>
  );
}
