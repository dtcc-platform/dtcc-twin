import type { ReactTable, RowData, rowPaginationFeature } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableProps<TData extends RowData> = {
  // Exactly this feature set: v9's table types are invariant, so a table with more features won't fit.
  table: ReactTable<{ rowPaginationFeature: typeof rowPaginationFeature }, TData>;
  query?: { isPending: boolean; isPlaceholderData: boolean; error: Error | null };
  emptyMessage?: string;
};

export function DataTable<TData extends RowData>({
  table,
  query = { isPending: false, isPlaceholderData: false, error: null },
  emptyMessage = "Nothing here.",
}: DataTableProps<TData>) {
  const rows = table.getRowModel().rows;
  const { pageIndex, pageSize } = table.state.pagination;
  const rowCount = table.getRowCount();
  const first = pageIndex * pageSize + 1;
  const last = Math.min(first + pageSize - 1, rowCount);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className={cn(query.isPlaceholderData && "opacity-60")}>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={table.getAllLeafColumns().length} className="h-24 text-center text-muted-foreground">
                {query.isPending ? (
                  <Spinner className="mx-auto" />
                ) : query.error ? (
                  <span className="text-destructive">{query.error.message}</span>
                ) : rowCount > 0 ? (
                  // Rows exist but not on this page: its last row was just deleted or approved away.
                  <Button variant="link" onClick={() => table.firstPage()}>
                    This page is empty. Go to the first page
                  </Button>
                ) : (
                  emptyMessage
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {table.options.manualPagination && rows.length > 0 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
          <span className="text-muted-foreground">{`${String(first)}–${String(last)} of ${String(rowCount)}`}</span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
              Next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
