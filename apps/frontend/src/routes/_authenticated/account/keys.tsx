import { maxApiKeysPerUser, type ApiKey } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createColumnHelper, rowPaginationFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { authQueries } from "@/api/auth";
import { keyMutations, keyQueries } from "@/api/keys";
import { ConfirmButton } from "@/components/common/confirm-button";
import { DataTable } from "@/components/common/data-table";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewKeyDialog } from "@/features/keys/new-key-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/account/keys")({ component: KeysPage });

const features = tableFeatures({ rowPaginationFeature });
const columnHelper = createColumnHelper<typeof features, ApiKey>();
const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: "Name",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        {row.original.description && (
          <span className="text-muted-foreground whitespace-normal">{row.original.description}</span>
        )}
      </div>
    ),
  }),
  columnHelper.accessor("prefix", {
    header: "Key",
    cell: ({ getValue }) => <code className="font-mono text-xs">{getValue()}…</code>,
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(undefined, { dateStyle: "medium" }),
  }),
  columnHelper.display({ id: "actions", header: "", cell: ({ row }) => <DeleteKeyButton apiKey={row.original} /> }),
]);

function KeysPage() {
  const me = useQuery(authQueries.me());
  const keys = useQuery(keyQueries.list());
  const items = keys.data?.items ?? [];
  const table = useTable({ features, columns, data: items });
  if (!me.data) return null;

  const active = me.data.status === "active";
  const full = items.length >= maxApiKeysPerUser;

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
          <div inert={!active} className={cn("flex flex-col gap-4", !active && "opacity-40")}>
            <CardAction>
              <NewKeyDialog disabled={!active || full || keys.isPending} />
            </CardAction>
            <DataTable table={table} query={keys} emptyMessage="No API keys yet." />
            {full && (
              <p className="text-sm text-muted-foreground">
                {`You have ${String(maxApiKeysPerUser)} keys, the most an account can have. Delete one to create another.`}
              </p>
            )}
          </div>
          {!active && (
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

function DeleteKeyButton({ apiKey }: { apiKey: ApiKey }) {
  const remove = useMutation(keyMutations.delete());

  return (
    <ConfirmButton
      label="Delete"
      title={`Delete ${apiKey.name}?`}
      description="Anything using this key stops working at once. This cannot be undone."
      disabled={remove.isPending}
      onConfirm={() =>
        remove.mutate(apiKey.id, {
          onSuccess: () => toast.success(`${apiKey.name} was deleted.`),
          onError: (error) => toast.error(error.message),
        })
      }
    />
  );
}
