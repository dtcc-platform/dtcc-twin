import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@repo/source", ...defaultClientConditions], tsconfigPaths: true },
  ssr: { resolve: { conditions: ["@repo/source", ...defaultServerConditions] } },
  test: { include: ["src/**/*.spec.ts"] },
});
