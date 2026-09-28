import { sql } from "drizzle-orm";
import { snakeCase, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";

export const users = snakeCase.table(
  "users",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    // Stored as given; the index below keeps it unique whatever its case.
    email: varchar({ length: 254 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    passwordHash: text().notNull(),
    role: text({ enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(sql`lower(${table.email})`)],
);
