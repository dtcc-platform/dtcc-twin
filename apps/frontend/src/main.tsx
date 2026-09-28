import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound } from "@/components/fallbacks/not-found";
import { RouteError } from "@/components/fallbacks/route-error";
import { queryClient } from "./api/client/query-client.ts";
import "./index.css";
import { routeTree } from "./routeTree.gen.ts";

const router = createRouter({
  routeTree,
  // Loaders prefetch with context.queryClient.ensureQueryData(…).
  context: { queryClient },
  defaultPreload: "intent",
  // tanstack-query owns caching
  defaultPreloadStaleTime: 0,
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing the #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
