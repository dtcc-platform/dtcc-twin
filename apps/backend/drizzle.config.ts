import { defineConfig } from "drizzle-kit";
import { envSchema } from "./src/config/env.schema.js";

// Deploys apply ./drizzle with `node dist/migrate.js`; `pnpm db:push` stays the quick way to sync a dev database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/**/*.table.ts",
  out: "./drizzle",
  dbCredentials: { url: envSchema.pick({ DATABASE_URL: true }).parse(process.env).DATABASE_URL },
});
