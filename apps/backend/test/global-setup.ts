import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** The container's `app` database: the maintenance connection, never used by an app. */
    databaseUrl: string;
    templateDatabase: string;
    /** Shared by every file: keys carry user ids, which are unique per test database. */
    valkeyUrl: string;
  }
}

// A fresh container per run, not `withReuse()`: a reused one is shared by every checkout on the
// machine, so concurrent runs dropped each other's databases.
let postgres: StartedPostgreSqlContainer;
let valkey: StartedTestContainer;

const execFileAsync = promisify(execFile);
const templateDatabase = "app_template";

export async function setup(project: TestProject): Promise<void> {
  // Same images and credentials as compose.yaml; only the host ports differ, and they are random.
  [postgres, valkey] = await Promise.all([
    new PostgreSqlContainer("postgres:18").withDatabase("app").withUsername("app").withPassword("app").start(),
    new GenericContainer("valkey/valkey:9").withExposedPorts(6379).start(),
  ]);
  const databaseUrl = postgres.getConnectionUri();
  await prepareTemplate(databaseUrl);
  project.provide("databaseUrl", databaseUrl);
  project.provide("templateDatabase", templateDatabase);
  project.provide("valkeyUrl", `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
}

/** Builds the database every e2e file clones (test/setup-env.ts), pushed the way `pnpm db:push` does. */
async function prepareTemplate(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`create database "${templateDatabase}"`);
  } finally {
    await client.end();
  }

  const templateUrl = new URL(databaseUrl);
  templateUrl.pathname = `/${templateDatabase}`;
  // The CLI, not the SDK's push(): the SDK leaves its pool connected, and Postgres refuses to clone
  // a template anyone is connected to.
  const { stdout } = await execFileAsync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "push", "--output", "json"],
    { env: { ...process.env, DATABASE_URL: templateUrl.toString() } },
  ).catch((error: unknown) => {
    throw new Error(`Pushing the schema to the template database failed: ${String(error)}`);
  });
  // `--output json` prints one envelope line: {"status":"ok"|"no_changes"|"missing_hints"|"error",…}
  const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as { status: string };
  if (result.status !== "ok" && result.status !== "no_changes") {
    throw new Error(`Pushing the schema to the template database failed: ${stdout}`);
  }
}

// A crashed run never gets here; Testcontainers' reaper removes its containers once the process exits.
export async function teardown(): Promise<void> {
  await Promise.all([postgres.stop(), valkey.stop()]);
}
