import { defineConfig } from "drizzle-kit";
import { envSchema } from "./src/config/env.schema.js";

// `pnpm db:push` only; there are no migrations until the first deploy with data worth keeping.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/**/*.table.ts",
  dbCredentials: { url: envSchema.pick({ DATABASE_URL: true }).parse(process.env).DATABASE_URL },
});
