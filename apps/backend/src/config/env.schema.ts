import type { ConfigService } from "@nestjs/config";
import { defaultAgentMaxAreaKm2 } from "@repo/contracts";
import { z } from "zod";

// DTCC Engine's own rule: it refuses to start with any other token, which could never match a Bearer header.
const engineTokenPattern = /^[A-Za-z0-9\-._~+/]+=*$/;

// .env.example leaves the engine and gateway variables empty, and empty means they aren't configured.
function emptyAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

// Each variable also goes in .env.example; env.schema.spec.ts fails if the two drift.
export const envFieldsSchema = z.object({
  AGENT_RESUME_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(5),
  AGENT_MAX_AREA_KM2: z.coerce.number().positive().default(defaultAgentMaxAreaKm2),
  AGENT_QUESTIONS_PER_DAY: z.coerce.number().int().positive().default(100),
  AGENT_DATASETS: z.string().default("city"),
  AGENT_JOB_WAIT_MS: z.coerce.number().int().nonnegative().default(45000),
  AGENT_MAX_MODEL_MB: z.coerce.number().positive().default(512),
  AGENT_MODEL_PROVIDER: z.enum(["bedrock", "anthropic", "scripted"]).default("scripted"),
  AWS_BEARER_TOKEN_BEDROCK: z.preprocess(emptyAsUnset, z.string().optional()),
  AGENT_BEDROCK_REGION: z.string().default("eu-north-1"),
  ANTHROPIC_API_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
  AGENT_MODEL: z.preprocess(emptyAsUnset, z.string().optional()),
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
  VALKEY_URL: z.url({ protocol: /^rediss?$/, error: "must be a redis:// or rediss:// URL" }),
  JWT_SECRET: z.string().min(32),
  ENGINE_URL: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional()),
  ENGINE_API_TOKEN: z.preprocess(
    emptyAsUnset,
    z.string().regex(engineTokenPattern, "must use only letters, digits, -._~+/ and trailing =").optional(),
  ),
  ENGINE_GATEWAY_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
  PACKAGE_STORAGE_DIR: z.string().min(1).default(".data/packages"),
  JOB_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(10),
  APISIX_ADMIN_URL: z.preprocess(
    emptyAsUnset,
    z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
  ),
  APISIX_ADMIN_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
  ADMIN_EMAIL: z.preprocess(emptyAsUnset, z.email().optional()),
  ADMIN_PASSWORD: z.preprocess(emptyAsUnset, z.string().min(8).max(128).optional()),
});

export const envSchema = envFieldsSchema.check((ctx) => {
  if (ctx.issues.length) return;
  const key =
    ctx.value.AGENT_MODEL_PROVIDER === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : ctx.value.AGENT_MODEL_PROVIDER === "bedrock"
        ? "AWS_BEARER_TOKEN_BEDROCK"
        : null;
  if (key && !ctx.value[key])
    ctx.issues.push({
      code: "custom",
      input: undefined,
      path: [key],
      message: "Required for the chosen model provider",
    });
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
