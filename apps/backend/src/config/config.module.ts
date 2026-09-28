import type { ConfigModuleOptions } from "@nestjs/config";
import { envSchema } from "./env.schema.js";

// A function so tests can cover a NODE_ENV other than their own.
export function configModuleOptions(): ConfigModuleOptions {
  // Runs before validation, so the schema's default is repeated here.
  const nodeEnv = process.env["NODE_ENV"] ?? "development";

  return {
    isGlobal: true,
    validationSchema: envSchema,
    // .env is for local development only; tests and production ignore it.
    ignoreEnvFile: nodeEnv !== "development",
  };
}
