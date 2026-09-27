import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { conditions: ["@repo/source", ...defaultClientConditions], tsconfigPaths: true },
  build: {
    // In kB. MapLibre, in its own chunk, is about 1,070; any other chunk this big still warns.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: "maplibre-gl", test: /[\\/]maplibre-gl[\\/]/ }] } },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: { "/api": "http://localhost:3030" },
  },
});
