import { sql } from "drizzle-orm";
import { index, snakeCase, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

/** A user's API key, which APISIX holds as a credential named by this id. The key itself is stored only there. */
export const apiKeys = snakeCase.table(
  "api_keys",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    prefix: varchar({ length: 16 }).notNull(),
    ...timestamps,
  },
  (table) => [index("api_keys_user_id_index").on(table.userId)],
);
