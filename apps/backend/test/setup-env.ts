import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

/**
 * Runs before each e2e file imports app.module.ts, which validates the environment at import time.
 * Each file gets its own database, cloned from global-setup.ts's template, so files run in parallel.
 */
const serverUrl = inject("databaseUrl");
const database = `test_${randomUUID().replaceAll("-", "")}`;

// The default strategy: `file_copy` forces a checkpoint and measured slower.
await maintenance(`create database "${database}" template "${inject("templateDatabase")}"`);

const databaseUrl = new URL(serverUrl);
databaseUrl.pathname = `/${database}`;
process.env["DATABASE_URL"] = databaseUrl.toString();
process.env["JWT_SECRET"] = randomBytes(32).toString("base64url");

async function maintenance(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}
