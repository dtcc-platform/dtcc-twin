import { sql } from "drizzle-orm";
import { index, snakeCase, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

export const chats = snakeCase.table(
  "chats",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar({ length: 100 }).notNull(),
    // Set while a turn runs: the chat's lock, so two turns never write one conversation at once.
    turnStartedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("chats_user_id_index").on(table.userId)],
);
