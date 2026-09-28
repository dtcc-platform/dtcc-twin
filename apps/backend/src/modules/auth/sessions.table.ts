import { sql } from "drizzle-orm";
import { index, snakeCase, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

export const userAgentMaxLength = 512;

/**
 * One login on one device, not server-side session state: requests are authenticated by the access
 * token alone, whose `sid` is this id. `updatedAt` doubles as "last used", since refreshing bumps it.
 */
export const sessions = snakeCase.table(
  "sessions",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: varchar({ length: 64 }).notNull().unique(),
    userAgent: varchar({ length: userAgentMaxLength }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("sessions_user_id_index").on(table.userId)],
);
