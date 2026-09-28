import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { resolve: { conditions: ["@repo/source", "module", "node", "development|production"] } },
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.spec.ts"] } },
      {
        test: {
          name: "e2e",
          include: ["test/**/*.e2e-spec.ts"],
          globalSetup: ["test/global-setup.ts"],
          setupFiles: ["test/setup-env.ts"],
        },
      },
    ],
  },
});
