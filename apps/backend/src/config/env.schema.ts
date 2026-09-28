import type { ConfigService } from "@nestjs/config";
import { z } from "zod";

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
