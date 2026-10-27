import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { authQueries } from "@/api/auth";
import { SubNav } from "@/components/common/sub-nav";
import { PageLayout } from "@/components/layout/page-layout";

export const Route = createFileRoute("/_authenticated/account")({ component: AccountLayout });

function AccountLayout() {
  // Not the route context's copy: this refetches on focus, so an approval shows without a reload.
  const me = useQuery(authQueries.me());

  return (
    <PageLayout className="max-w-2xl">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">{me.data?.name}</h1>
        <p className="text-muted-foreground">{me.data?.email}</p>
      </div>
      <SubNav>
        <Link to="/account" activeOptions={{ exact: true }}>
          Profile
        </Link>
        <Link to="/account/keys">API keys</Link>
      </SubNav>
      <Outlet />
    </PageLayout>
  );
}
