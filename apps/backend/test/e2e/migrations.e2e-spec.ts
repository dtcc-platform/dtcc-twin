import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { migrateDatabase } from "../../src/infra/database/migrations.js";

const execFileAsync = promisify(execFile);

// Every other file clones a database the schema was pushed into; this one starts from an empty one, as a deploy does.
describe("Migrations (e2e)", () => {
  let databaseUrl: string;

  beforeAll(async () => {
    const serverUrl = inject("databaseUrl");
    const database = `migrations_${randomUUID().replaceAll("-", "")}`;
    const client = new pg.Client({ connectionString: serverUrl });
    await client.connect();
    try {
      await client.query(`create database "${database}"`);
    } finally {
      await client.end();
    }
    const url = new URL(serverUrl);
    url.pathname = `/${database}`;
    databaseUrl = url.toString();
  });

  it("bring an empty database to the schema of the *.table.ts files", async () => {
    await migrateDatabase(databaseUrl);

    // A table changed without a new migration makes push find something to do.
    expect(await pushStatus(databaseUrl)).toBe("no_changes");
  });

  it("change nothing when they run again", async () => {
    await migrateDatabase(databaseUrl);
    const applied = await countApplied(databaseUrl);

    await migrateDatabase(databaseUrl);

    expect(await countApplied(databaseUrl)).toBe(applied);
    expect(applied).toBeGreaterThan(0);
  });
});

async function pushStatus(databaseUrl: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "push", "--output", "json"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
  // `--output json` prints one envelope line: {"status":"ok"|"no_changes"|"missing_hints"|"error",…}
  return (JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as { status: string }).status;
}

async function countApplied(databaseUrl: string): Promise<number> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations");
    return Number(rows[0]?.count);
  } finally {
    await client.end();
  }
}
