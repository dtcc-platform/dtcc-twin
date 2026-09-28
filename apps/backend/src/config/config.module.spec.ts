import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configModuleOptions } from "./config.module.js";
import type { EnvConfigService } from "./env.schema.js";

describe("configModuleOptions", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://app:app@localhost:5432/app");
    vi.stubEnv("JWT_SECRET", "a-test-secret-that-is-32-chars-long");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to build the module, naming the variable, when a value is invalid", async () => {
    vi.stubEnv("PORT", "abc");

    await expect(ConfigModule.forRoot(configModuleOptions())).rejects.toThrow(/PORT/);
  });

  it("serves the validated value rather than the raw string", async () => {
    vi.stubEnv("PORT", "4001");

    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot(configModuleOptions())],
    }).compile();
    const config: EnvConfigService = moduleRef.get(ConfigService);

    expect(config.get("PORT", { infer: true })).toBe(4001);
    await moduleRef.close();
  });

  it("reads a local .env file in development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(configModuleOptions().ignoreEnvFile).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    expect(configModuleOptions().ignoreEnvFile).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(configModuleOptions().ignoreEnvFile).toBe(true);
  });
});
