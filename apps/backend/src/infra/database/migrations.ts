import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// apps/backend/drizzle, from both src/ and dist/; the production image keeps that layout.
const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** Applies every migration in ./drizzle that the database hasn't run yet, each in its own transaction. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
