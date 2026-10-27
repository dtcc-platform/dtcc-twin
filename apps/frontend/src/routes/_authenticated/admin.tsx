import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { SubNav } from "@/components/common/sub-nav";
import { PageLayout } from "@/components/layout/page-layout";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") throw redirect({ to: "/" });
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <PageLayout className="max-w-5xl">
      <h1 className="text-4xl font-semibold tracking-tight">Admin</h1>
      <SubNav>
        <Link to="/admin" activeOptions={{ exact: true }}>
          Dashboard
        </Link>
        <Link to="/admin/users">Users</Link>
        <Link to="/admin/dev">Dev</Link>
      </SubNav>
      <Outlet />
    </PageLayout>
  );
}
