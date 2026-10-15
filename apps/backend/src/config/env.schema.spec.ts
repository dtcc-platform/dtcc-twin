import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { envSchema } from "./env.schema.js";

const DATABASE_URL = "postgres://app:app@localhost:5432/app";
const JWT_SECRET = "a-test-secret-that-is-32-chars-long";
const required = { DATABASE_URL, JWT_SECRET };

describe("envSchema", () => {
  it("fills in the defaults for everything but the secrets, and leaves the engine and the gateway unconfigured", () => {
    const { ENGINE_URL, ENGINE_API_TOKEN, APISIX_ADMIN_URL, APISIX_ADMIN_KEY, ...rest } = envSchema.parse(required);

    expect(rest).toStrictEqual({
      NODE_ENV: "development",
      PORT: 3030,
      CORS_ORIGINS: [],
      DATABASE_URL,
      JWT_SECRET,
      PACKAGE_STORAGE_DIR: ".data/packages",
    });
    expect(ENGINE_URL).toBeUndefined();
    expect(ENGINE_API_TOKEN).toBeUndefined();
    expect(APISIX_ADMIN_URL).toBeUndefined();
    expect(APISIX_ADMIN_KEY).toBeUndefined();
  });

  it("requires DATABASE_URL, since a default would carry credentials", () => {
    expect(() => envSchema.parse({ JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it("requires a JWT_SECRET of at least 32 characters, since a default would be public", () => {
    expect(() => envSchema.parse({ DATABASE_URL })).toThrow(/JWT_SECRET/);
    expect(() => envSchema.parse({ DATABASE_URL, JWT_SECRET: "a".repeat(31) })).toThrow(/JWT_SECRET/);
  });

  it("accepts only a Postgres DATABASE_URL", () => {
    expect(
      envSchema.parse({ JWT_SECRET, DATABASE_URL: "postgresql://app:app@db:5432/app?sslmode=require" }).DATABASE_URL,
    ).toBe("postgresql://app:app@db:5432/app?sslmode=require");
    expect(() => envSchema.parse({ JWT_SECRET, DATABASE_URL: "mysql://app:app@db:3306/app" })).toThrow(/DATABASE_URL/);
    expect(() => envSchema.parse({ JWT_SECRET, DATABASE_URL: "localhost:5432/app" })).toThrow(/DATABASE_URL/);
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
    const env = envSchema.parse({ ENGINE_URL: "", ENGINE_API_TOKEN: "", ...required });

    expect(env.ENGINE_URL).toBeUndefined();
    expect(env.ENGINE_API_TOKEN).toBeUndefined();
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
