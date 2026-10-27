import type { User } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  createColumnHelper,
  rowPaginationFeature,
  tableFeatures,
  useTable,
  type PaginationState,
} from "@tanstack/react-table";
import { useState } from "react";
import { accountQueries } from "@/api/accounts";
import { DataTable } from "@/components/common/data-table";
import { AccountAdminDialog } from "@/features/accounts/account-admin-dialog";
import { AccountStatusActions } from "@/features/accounts/account-status-actions";

export const Route = createFileRoute("/_authenticated/admin/")({ component: AdminDashboard });

const features = tableFeatures({ rowPaginationFeature });
const columnHelper = createColumnHelper<typeof features, User>();
const columns = columnHelper.columns([
  columnHelper.accessor("name", { header: "Name", cell: ({ row }) => <AccountAdminDialog user={row.original} /> }),
  columnHelper.accessor("email", { header: "Email" }),
  columnHelper.accessor("createdAt", {
    header: "Registered",
    cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
  }),
  columnHelper.display({
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex gap-2">
        <AccountStatusActions user={row.original} />
      </div>
    ),
  }),
]);

function AdminDashboard() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const pending = useQuery(
    accountQueries.list({
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
      status: "pending",
    }),
  );
  const table = useTable({
    features,
    columns,
    data: pending.data?.items ?? [],
    rowCount: pending.data?.total,
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
  });

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Waiting for approval</h2>
        <p className="text-sm text-muted-foreground">New accounts can create API keys once you approve them.</p>
      </div>
      <DataTable table={table} query={pending} emptyMessage="Nobody is waiting for approval." />
    </section>
  );
}
