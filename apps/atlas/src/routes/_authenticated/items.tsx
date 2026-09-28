import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { itemQueries } from "@/api/items";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const pageSize = 10;

export const Route = createFileRoute("/_authenticated/items")({
  // In the URL, so a page survives a reload and the back button.
  validateSearch: z.object({ offset: z.number().int().min(0).default(0) }),
  component: ItemsPage,
});

// A minimal list until the items get a proper table.
function ItemsPage() {
  const { offset } = Route.useSearch();
  const items = useQuery(itemQueries.list({ limit: pageSize, offset }));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-4xl font-semibold tracking-tight">Your items</h1>
      {items.isPending && <Spinner />}
      {items.isError && <p className="text-destructive">{items.error.message}</p>}
      {items.data && (
        <>
          {items.data.items.length === 0 ? (
            <p className="text-muted-foreground">No items here.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {items.data.items.map((item) => (
                <li key={item.id} className="p-4">
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                </li>
              ))}
            </ul>
          )}
          <Pager offset={offset} total={items.data.total} />
        </>
      )}
    </main>
  );
}

function Pager({ offset, total }: { offset: number; total: number }) {
  const hasPrevious = offset > 0;
  const hasNext = offset + pageSize < total;
  const last = Math.min(offset + pageSize, total);

  return (
    <nav className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        {total === 0 ? "0 items" : `${String(offset + 1)}–${String(last)} of ${String(total)}`}
      </span>
      <span className="flex gap-2">
        {hasPrevious && (
          <Link
            to="/items"
            search={{ offset: Math.max(0, offset - pageSize) }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Previous
          </Link>
        )}
        {hasNext && (
          <Link
            to="/items"
            search={{ offset: offset + pageSize }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Next
          </Link>
        )}
      </span>
    </nav>
  );
}
