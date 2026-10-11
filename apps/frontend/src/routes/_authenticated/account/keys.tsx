import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createColumnHelper, rowPaginationFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { authQueries } from "@/api/auth";
import { DataTable } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/account/keys")({ component: KeysPage });

// REVIEW: a placeholder shape until the keys contract arrives in step 4; step 5 fills the table.
type ApiKey = { id: string; name: string; prefix: string; createdAt: string; revokedAt: string | null };

const features = tableFeatures({ rowPaginationFeature });
const columnHelper = createColumnHelper<typeof features, ApiKey>();
const columns = columnHelper.columns([
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("prefix", { header: "Key" }),
  columnHelper.accessor("createdAt", { header: "Created" }),
  columnHelper.accessor("revokedAt", { header: "Revoked" }),
]);

function KeysPage() {
  const me = useQuery(authQueries.me());
  const table = useTable({ features, columns, data: [] });
  if (!me.data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Keys let DTCC Core reach our data services. Each key is shown once, when you create it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div
            inert={me.data.status !== "active"}
            className={cn("flex flex-col gap-4", me.data.status !== "active" && "opacity-40")}
          >
            <CardAction>
              <Button disabled>New key</Button>
            </CardAction>
            <DataTable table={table} emptyMessage="No API keys yet." />
          </div>
          {me.data.status !== "active" && (
            <p className="absolute inset-0 m-auto h-fit max-w-sm rounded-lg border bg-background p-4 text-center text-sm shadow-sm">
              {me.data.status === "pending"
                ? "Your account is waiting for an admin's approval. You can create API keys once it is approved."
                : "Your account has been disabled."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
