import { sql } from "drizzle-orm";
import { index, snakeCase, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

export const items = snakeCase.table(
  "items",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    ...timestamps,
  },
  (table) => [index("items_user_id_index").on(table.userId)],
);
