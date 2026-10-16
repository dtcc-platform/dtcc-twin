import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApplyTheme } from "@/hooks/use-theme";

type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

function RootLayout() {
  useApplyTheme();

  return (
    <>
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
      <Toaster />
      <ReactQueryDevtools buttonPosition="bottom-right" />
      <TanStackRouterDevtools position="bottom-left" />
    </>
  );
}
