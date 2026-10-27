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
import { AccountStatusBadge } from "@/features/accounts/account-status-badge";

export const Route = createFileRoute("/_authenticated/admin/users")({ component: UsersPage });

const features = tableFeatures({ rowPaginationFeature });
const columnHelper = createColumnHelper<typeof features, User>();
const columns = columnHelper.columns([
  columnHelper.accessor("name", { header: "Name", cell: ({ row }) => <AccountAdminDialog user={row.original} /> }),
  columnHelper.accessor("email", { header: "Email" }),
  columnHelper.accessor("role", { header: "Role" }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: ({ getValue }) => <AccountStatusBadge status={getValue()} />,
  }),
  columnHelper.accessor("createdAt", {
    header: "Registered",
    cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
  }),
]);

function UsersPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const users = useQuery(
    accountQueries.list({ limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize }),
  );
  const table = useTable({
    features,
    columns,
    data: users.data?.items ?? [],
    rowCount: users.data?.total,
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
  });

  return <DataTable table={table} query={users} emptyMessage="No users yet." />;
}
