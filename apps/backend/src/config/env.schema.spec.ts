import { readFileSync } from "node:fs";
import { defaultAgentMaxAreaKm2 } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { envSchema, envFieldsSchema } from "./env.schema.js";

const DATABASE_URL = "postgres://app:app@localhost:5432/app";
const JWT_SECRET = "a-test-secret-that-is-32-chars-long";
const VALKEY_URL = "redis://localhost:6379";
const required = { DATABASE_URL, JWT_SECRET, VALKEY_URL };

it("keeps individual environment fields pickable without provider credentials", () => {
  expect(envFieldsSchema.pick({ DATABASE_URL: true }).parse({ DATABASE_URL, AGENT_MODEL_PROVIDER: "bedrock" })).toEqual(
    { DATABASE_URL },
  );
});

// drizzle-kit loads this schema before the contracts are built, so it keeps its own copy of the panel's limit.
it("defaults the area limit to the one the agent panel warns about", () => {
  expect(envSchema.parse(required).AGENT_MAX_AREA_KM2).toBe(defaultAgentMaxAreaKm2);
});

describe("envSchema", () => {
  it("requires the chosen model provider's key", () => {
    expect(() => envSchema.parse({ ...required, AGENT_MODEL_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => envSchema.parse({ ...required, AGENT_MODEL_PROVIDER: "bedrock" })).toThrow(/AWS_BEARER_TOKEN_BEDROCK/);
  });
  it("fills in the defaults for everything but the secrets, and leaves the engine and the gateway unconfigured", () => {
    const {
      ENGINE_URL,
      ENGINE_API_TOKEN,
      ENGINE_GATEWAY_KEY,
      APISIX_ADMIN_URL,
      APISIX_ADMIN_KEY,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ...rest
    } = envSchema.parse(required);

    expect(rest).toStrictEqual({
      AGENT_RESUME_INTERVAL_SECONDS: 5,
      AGENT_MAX_AREA_KM2: 5,
      AGENT_QUESTIONS_PER_DAY: 100,
      AGENT_DATASETS: "city",
      AGENT_JOB_WAIT_MS: 45000,
      AGENT_MAX_MODEL_MB: 512,
      AGENT_MODEL_PROVIDER: "scripted",
      AGENT_BEDROCK_REGION: "eu-north-1",
      NODE_ENV: "development",
      PORT: 3030,
      CORS_ORIGINS: [],
      DATABASE_URL,
      JWT_SECRET,
      VALKEY_URL,
      PACKAGE_STORAGE_DIR: ".data/packages",
      JOB_LIMIT_PER_HOUR: 10,
    });
    expect(ENGINE_URL).toBeUndefined();
    expect(ENGINE_API_TOKEN).toBeUndefined();
    expect(ENGINE_GATEWAY_KEY).toBeUndefined();
    expect(APISIX_ADMIN_URL).toBeUndefined();
    expect(APISIX_ADMIN_KEY).toBeUndefined();
    expect(ADMIN_EMAIL).toBeUndefined();
    expect(ADMIN_PASSWORD).toBeUndefined();
  });

  it("treats empty ADMIN_EMAIL and ADMIN_PASSWORD as unset, and checks them when set", () => {
    const empty = envSchema.parse({ ADMIN_EMAIL: "", ADMIN_PASSWORD: "", ...required });
    expect(empty.ADMIN_EMAIL).toBeUndefined();
    expect(empty.ADMIN_PASSWORD).toBeUndefined();

    const set = envSchema.parse({ ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "a-long-password", ...required });
    expect(set.ADMIN_EMAIL).toBe("admin@example.com");
    expect(() => envSchema.parse({ ADMIN_EMAIL: "admin", ...required })).toThrow(/ADMIN_EMAIL/);
    expect(() => envSchema.parse({ ADMIN_PASSWORD: "short", ...required })).toThrow(/ADMIN_PASSWORD/);
  });

  it("requires DATABASE_URL, since a default would carry credentials", () => {
    expect(() => envSchema.parse({ JWT_SECRET, VALKEY_URL })).toThrow(/DATABASE_URL/);
  });

  it("requires a JWT_SECRET of at least 32 characters, since a default would be public", () => {
    expect(() => envSchema.parse({ DATABASE_URL, VALKEY_URL })).toThrow(/JWT_SECRET/);
    expect(() => envSchema.parse({ DATABASE_URL, VALKEY_URL, JWT_SECRET: "a".repeat(31) })).toThrow(/JWT_SECRET/);
  });

  it("accepts only a Postgres DATABASE_URL", () => {
    expect(
      envSchema.parse({ JWT_SECRET, VALKEY_URL, DATABASE_URL: "postgresql://app:app@db:5432/app?sslmode=require" })
        .DATABASE_URL,
    ).toBe("postgresql://app:app@db:5432/app?sslmode=require");
    expect(() => envSchema.parse({ JWT_SECRET, VALKEY_URL, DATABASE_URL: "mysql://app:app@db:3306/app" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => envSchema.parse({ JWT_SECRET, VALKEY_URL, DATABASE_URL: "localhost:5432/app" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("requires VALKEY_URL, so a deployment without one fails at boot instead of never becoming ready", () => {
    expect(() => envSchema.parse({ DATABASE_URL, JWT_SECRET })).toThrow(/VALKEY_URL/);
  });

  it("accepts only a redis:// or rediss:// VALKEY_URL", () => {
    expect(envSchema.parse({ ...required, VALKEY_URL: "redis://valkey:6379" }).VALKEY_URL).toBe("redis://valkey:6379");
    expect(envSchema.parse({ ...required, VALKEY_URL: "rediss://valkey.example.com:6380" }).VALKEY_URL).toBe(
      "rediss://valkey.example.com:6380",
    );
    expect(() => envSchema.parse({ ...required, VALKEY_URL: "http://valkey:6379" })).toThrow(/VALKEY_URL/);
    expect(() => envSchema.parse({ ...required, VALKEY_URL: "valkey:6379" })).toThrow(/VALKEY_URL/);
  });

  it("splits CORS_ORIGINS on commas and trims each origin", () => {
    expect(
      envSchema.parse({ CORS_ORIGINS: "http://localhost:3000, https://app.example.com", ...required }).CORS_ORIGINS,
    ).toEqual(["http://localhost:3000", "https://app.example.com"]);
  });

  it("rejects a CORS origin that is not a bare origin, naming the variable", () => {
    expect(() => envSchema.parse({ CORS_ORIGINS: "http://localhost:3000/", ...required })).toThrow(/CORS_ORIGINS/);
    expect(() => envSchema.parse({ CORS_ORIGINS: "localhost:3000", ...required })).toThrow(/CORS_ORIGINS/);
  });

  it("accepts only a whole JOB_LIMIT_PER_HOUR of at least 1", () => {
    expect(envSchema.parse({ JOB_LIMIT_PER_HOUR: "25", ...required }).JOB_LIMIT_PER_HOUR).toBe(25);
    for (const value of ["0", "-1", "1.5", "many"]) {
      expect(() => envSchema.parse({ JOB_LIMIT_PER_HOUR: value, ...required })).toThrow(/JOB_LIMIT_PER_HOUR/);
    }
  });

  it("coerces PORT to a number", () => {
    expect(envSchema.parse({ PORT: "4000", ...required }).PORT).toBe(4000);
  });

  it("names the offending variable when a value is invalid", () => {
    expect(() => envSchema.parse({ PORT: "abc", ...required })).toThrow(/PORT/);
  });

  it("rejects a NODE_ENV outside the known environments", () => {
    expect(() => envSchema.parse({ NODE_ENV: "staging", ...required })).toThrow(/NODE_ENV/);
  });

  it("treats empty engine variables as unset, since .env.example leaves them empty", () => {
    const env = envSchema.parse({ ENGINE_URL: "", ENGINE_API_TOKEN: "", ENGINE_GATEWAY_KEY: "", ...required });

    expect(env.ENGINE_URL).toBeUndefined();
    expect(env.ENGINE_API_TOKEN).toBeUndefined();
    expect(env.ENGINE_GATEWAY_KEY).toBeUndefined();
  });

  it("accepts only an http(s) ENGINE_URL", () => {
    expect(envSchema.parse({ ENGINE_URL: "https://engine.example.com", ...required }).ENGINE_URL).toBe(
      "https://engine.example.com",
    );
    expect(() => envSchema.parse({ ENGINE_URL: "ftp://engine.example.com", ...required })).toThrow(/ENGINE_URL/);
    expect(() => envSchema.parse({ ENGINE_URL: "localhost:8000", ...required })).toThrow(/ENGINE_URL/);
  });

  it("accepts only an ENGINE_API_TOKEN the engine accepts", () => {
    expect(envSchema.parse({ ENGINE_API_TOKEN: "a1-._~+/==", ...required }).ENGINE_API_TOKEN).toBe("a1-._~+/==");
    expect(() => envSchema.parse({ ENGINE_API_TOKEN: "has space", ...required })).toThrow(/ENGINE_API_TOKEN/);
    expect(() => envSchema.parse({ ENGINE_API_TOKEN: "a=b", ...required })).toThrow(/ENGINE_API_TOKEN/);
  });

  it("treats empty gateway variables as unset, since .env.example leaves them empty", () => {
    const env = envSchema.parse({ APISIX_ADMIN_URL: "", APISIX_ADMIN_KEY: "", ...required });

    expect(env.APISIX_ADMIN_URL).toBeUndefined();
    expect(env.APISIX_ADMIN_KEY).toBeUndefined();
  });

  it("accepts only an http(s) APISIX_ADMIN_URL", () => {
    expect(envSchema.parse({ APISIX_ADMIN_URL: "http://127.0.0.1:9180", ...required }).APISIX_ADMIN_URL).toBe(
      "http://127.0.0.1:9180",
    );
    expect(() => envSchema.parse({ APISIX_ADMIN_URL: "127.0.0.1:9180", ...required })).toThrow(/APISIX_ADMIN_URL/);
  });

  it("drops the unrelated variables that process.env always carries", () => {
    expect(envSchema.parse({ SHELL: "/bin/zsh", ...required })).not.toHaveProperty("SHELL");
  });
});

describe(".env.example", () => {
  it("declares exactly the variables the schema knows about", () => {
    const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    const declared = example
      .split("\n")
      .map((line) => /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1])
      .filter((key) => key !== undefined);

    expect(declared.toSorted()).toStrictEqual(Object.keys(envSchema.shape).toSorted());
  });
});
