import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** The container's `app` database: the maintenance connection, never used by an app. */
    databaseUrl: string;
    templateDatabase: string;
  }
}

// A fresh container per run, not `withReuse()`: a reused one is shared by every checkout on the
// machine, so concurrent runs dropped each other's databases.
let container: StartedPostgreSqlContainer;

const execFileAsync = promisify(execFile);
const templateDatabase = "app_template";

export async function setup(project: TestProject): Promise<void> {
  // Same image and credentials as compose.yaml; only the host port differs, and it is random.
  container = await new PostgreSqlContainer("postgres:18")
    .withDatabase("app")
    .withUsername("app")
    .withPassword("app")
    .start();
  const databaseUrl = container.getConnectionUri();
  await prepareTemplate(databaseUrl);
  project.provide("databaseUrl", databaseUrl);
  project.provide("templateDatabase", templateDatabase);
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

// A crashed run never gets here; Testcontainers' reaper removes its container once the process exits.
export async function teardown(): Promise<void> {
  await container.stop();
}
