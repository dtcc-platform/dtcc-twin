import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { SubNav } from "@/components/layout/sub-nav";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") throw redirect({ to: "/" });
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Admin</h1>
      <SubNav>
        <Link to="/admin" activeOptions={{ exact: true }}>
          Dashboard
        </Link>
        <Link to="/admin/users">Users</Link>
      </SubNav>
      <Outlet />
    </main>
  );
}
