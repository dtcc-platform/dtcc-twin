import { sql } from "drizzle-orm";
import { doublePrecision, index, snakeCase, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

// A user's named area, the UI's bookmarks: a box in WGS84 degrees, as the map draws it.
export const savedAreas = snakeCase.table(
  "saved_areas",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    west: doublePrecision().notNull(),
    south: doublePrecision().notNull(),
    east: doublePrecision().notNull(),
    north: doublePrecision().notNull(),
    ...timestamps,
  },
  (table) => [index("saved_areas_user_id_index").on(table.userId)],
);
