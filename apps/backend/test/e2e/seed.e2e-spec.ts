import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { developmentPassword, seedData } from "../../scripts/seed-data.js";
import { verifyPassword } from "../../src/modules/users/password.js";
import { query, truncateAllTables } from "../helpers/database.js";

const execFileAsync = promisify(execFile);

// A child that outlives a timed-out test seeds the database under the next one, so the child dies first.
const childTimeout = 20_000;

/** Runs `scripts/seed.ts`, typing `answer` at the prompt. Ignores `.env`: pass variables through `env`. */
async function seed({ answer = "", env = {} }: { answer?: string; env?: Record<string, string> } = {}) {
  const run = execFileAsync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], {
    env: { ...process.env, ...env },
    timeout: childTimeout,
  });
  run.child.stdin?.end(answer);
  return run;
}

async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const { table } of seedData) {
    const name = getTableName(table);
    const [row] = await query<{ count: number }>(`select count(*)::int as count from "${name}"`);
    counts[name] = row?.count ?? 0;
  }
  return counts;
}

const seededCounts = Object.fromEntries(seedData.map(({ table, values }) => [getTableName(table), values.length]));

async function insertOtherUser(): Promise<void> {
  await query("insert into users (email, name, password_hash) values ('grace@example.com', 'Grace Hopper', 'unused')");
}

async function otherUserExists(): Promise<boolean> {
  return (await query("select 1 from users where email = 'grace@example.com'")).length > 0;
}

describe("pnpm db:seed (e2e)", { timeout: childTimeout + 10_000 }, () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("seeds an empty database without asking", async () => {
    await seed();

    expect(await rowCounts()).toEqual(seededCounts);
  });

  it("seeds an admin who logs in with the development password", async () => {
    await seed();

    const [admin] = await query<{ role: string; password_hash: string }>(
      "select role, password_hash from users where email = 'admin@example.com'",
    );
    expect(admin?.role).toBe("admin");
    expect(await verifyPassword(admin?.password_hash ?? "", developmentPassword)).toBe(true);
  });

  it.each([
    ["answered no", "n\n"],
    ["given no answer", ""],
  ])("leaves a database that is not empty untouched when %s", async (_, answer) => {
    await insertOtherUser();

    await expect(seed({ answer })).rejects.toMatchObject({ code: 1 });

    expect(await otherUserExists()).toBe(true);
    expect(await rowCounts()).toMatchObject({ users: 1, settings: 0, items: 0 });
  });

  it("wipes a database that is not empty and seeds it when answered yes", async () => {
    await insertOtherUser();

    await seed({ answer: "y\n" });

    expect(await otherUserExists()).toBe(false);
    expect(await rowCounts()).toEqual(seededCounts);
  });

  it("refuses to run in production", async () => {
    // execFile's rejection message carries the child's stderr.
    await expect(seed({ env: { NODE_ENV: "production" } })).rejects.toThrow(
      "Refusing to seed: NODE_ENV is production.",
    );
    expect(await rowCounts()).toMatchObject({ users: 0, settings: 0, items: 0 });
  });
});
