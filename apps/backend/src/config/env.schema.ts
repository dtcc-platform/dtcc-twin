import type { ConfigService } from "@nestjs/config";
import { z } from "zod";

// DTCC Engine's own rule: it refuses to start with any other token, which could never match a Bearer header.
const engineTokenPattern = /^[A-Za-z0-9\-._~+/]+=*$/;

// .env.example leaves the engine and gateway variables empty, and empty means they aren't configured.
function emptyAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

// Each variable also goes in .env.example; env.schema.spec.ts fails if the two drift.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3030),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().refine(isOrigin, "must be a bare origin such as https://app.example.com"))),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// URL" }),
  JWT_SECRET: z.string().min(32),
  ENGINE_URL: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional()),
  ENGINE_API_TOKEN: z.preprocess(
    emptyAsUnset,
    z.string().regex(engineTokenPattern, "must use only letters, digits, -._~+/ and trailing =").optional(),
  ),
  ENGINE_GATEWAY_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
  PACKAGE_STORAGE_DIR: z.string().min(1).default(".data/packages"),
  APISIX_ADMIN_URL: z.preprocess(
    emptyAsUnset,
    z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
  ),
  APISIX_ADMIN_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
  ADMIN_EMAIL: z.preprocess(emptyAsUnset, z.email().optional()),
  ADMIN_PASSWORD: z.preprocess(emptyAsUnset, z.string().min(8).max(128).optional()),
});

function isOrigin(value: string): boolean {
  return URL.canParse(value) && new URL(value).origin === value;
}

export type Env = z.output<typeof envSchema>;

/**
 * Typed `ConfigService`: `const config: EnvConfigService = app.get(ConfigService)`. Constructor
 * parameters must name the class instead, `ConfigService<Env, true>`: an alias can't be injected.
 */
export type EnvConfigService = ConfigService<Env, true>;
