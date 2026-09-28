import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { conditions: ["@repo/source", ...defaultClientConditions], tsconfigPaths: true },
  server: {
    port: 3000,
    strictPort: true,
    proxy: { "/api": "http://localhost:3030" },
  },
});
