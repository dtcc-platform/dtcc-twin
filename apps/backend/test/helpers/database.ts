import pg from "pg";

/** Empties this file's database, which the tests inside the file share. */
export async function truncateAllTables(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = 'public'",
    );
    if (rows.length > 0) await client.query(`truncate ${rows.map(({ name }) => `"${name}"`).join(", ")} cascade`);
  } finally {
    await client.end();
  }
}

/** Runs SQL against this file's database directly, for what the API does not expose. */
export async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}
