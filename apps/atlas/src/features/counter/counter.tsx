import { CounterStoreProvider } from "./counter-store-provider.tsx";
import { useCount, useCounterActions } from "./counter-store.ts";
import { Button } from "@/components/ui/button";

export function Counter({ title, initialCount }: { title: string; initialCount: number }) {
  return (
    <CounterStoreProvider initialCount={initialCount}>
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-semibold">{title}</h2>
        <CounterValue />
        <CounterControls />
      </section>
    </CounterStoreProvider>
  );
}

function CounterValue() {
  const count = useCount();

  return <p className="font-mono text-4xl tabular-nums">{count}</p>;
}

// Selects only the actions, which never change, so it does not re-render when the count does.
function CounterControls() {
  const { increment, decrement, reset } = useCounterActions();

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={decrement}>
        −
      </Button>
      <Button variant="outline" onClick={increment}>
        +
      </Button>
      <Button variant="ghost" onClick={reset}>
        Reset
      </Button>
    </div>
  );
}
