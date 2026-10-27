import { Counter } from "@/features/counter/counter";

/** Two counters, each with its own Zustand store. */
export function CountersDemo() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-4xl font-semibold tracking-tight">Localized Zustand stores</h1>
      <p className="text-muted-foreground">Each counter has its own store, so changing one leaves the other alone.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Counter title="Starts at 0" initialCount={0} />
        <Counter title="Starts at 10" initialCount={10} />
      </div>
    </div>
  );
}
