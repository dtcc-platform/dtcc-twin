import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { envSchema } from "../src/config/env.schema.js";
import { seedData } from "./seed-data.js";

// An empty database is seeded at once; otherwise it asks before wiping, and any answer but yes exits 1.
const env = envSchema.pick({ NODE_ENV: true, DATABASE_URL: true }).parse(process.env);
if (env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle({ client: pool });
const tables = seedData.map(({ table }) => table);

try {
  const counts = await Promise.all(tables.map((table) => db.$count(table)));
  const empty = counts.every((count) => count === 0);
  if (empty || (await confirm("The database is not empty. Wipe it and seed? [y/N] "))) {
    await db.transaction(async (tx) => {
      if (!empty) await tx.execute(sql`truncate ${sql.join(tables, sql`, `)} cascade`);
      for (const { insert } of seedData) await insert(tx);
    });
    console.log("Seeded.");
  } else {
    console.error("Nothing changed.");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  // Input that ends early (CI, a closed pipe) never settles question(); the close counts as no.
  const closed = once(prompt, "close").then(() => "");
  try {
    return /^y(es)?$/i.test((await Promise.race([prompt.question(question), closed])).trim());
  } finally {
    prompt.close();
  }
}
