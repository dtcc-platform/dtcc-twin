import { Logger } from "@nestjs/common";
import { getDrizzleToken } from "@nestjs/drizzle";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import type { Database } from "../../src/infra/database/database.js";
import { createTestApp } from "../helpers/create-test-app.js";

describe("Test database (e2e)", () => {
  it("is a Postgres 18 that a worker can reach through the provided URI", async () => {
    const databaseUrl = inject("databaseUrl");
    expect(databaseUrl).toMatch(/^postgres(ql)?:\/\/app:app@.+\/app$/);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string; version: string }>(
        "select uuidv7()::text as id, current_setting('server_version') as version",
      );
      expect(rows[0]?.version).toMatch(/^18\./);
      expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    } finally {
      await client.end();
    }
  });
});

describe("Per-file test database (e2e)", () => {
  it("is this file's own clone of the template, with the template's tables", async () => {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");
    expect(new URL(databaseUrl).pathname).toMatch(/^\/test_[0-9a-f]{32}$/);

    const tablesOf = async (connectionString: string) => {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try {
        const { rows } = await client.query<{ name: string }>(
          "select table_name as name from information_schema.tables where table_schema = 'public' order by 1",
        );
        return rows.map((row) => row.name);
      } finally {
        await client.end();
      }
    };
    const template = new URL(inject("databaseUrl"));
    template.pathname = `/${inject("templateDatabase")}`;

    const own = await tablesOf(databaseUrl);
    expect(own.length).toBeGreaterThan(0);
    expect(own).toEqual(await tablesOf(template.toString()));
  });
});

describe("Database module (e2e)", () => {
  it("queries through the app's pool and closes it with the app", async () => {
    const app = await createTestApp();
    const db = app.get<Database>(getDrizzleToken());

    const { rows } = await db.execute<{ answer: number }>(sql`select 1 as answer`);
    expect(rows).toEqual([{ answer: 1 }]);

    await app.close();
    expect(db.$client.ended).toBe(true);
  });

  it("survives an idle connection being dropped by the server", async () => {
    const app = await createTestApp();
    const db = app.get<Database>(getDrizzleToken());
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    // After the query, the pool keeps this connection idle; terminating it from outside is what a
    // database restart or failover does to every idle connection at once.
    const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    const admin = new pg.Client({ connectionString: inject("databaseUrl") });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend($1)", [rows[0]?.pid]);
    } finally {
      await admin.end();
    }

    await vi.waitFor(() => {
      expect(db.$client.totalCount).toBe(0);
    });
    expect(logged).toHaveBeenCalled();
    await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
    await app.close();
  });
});
