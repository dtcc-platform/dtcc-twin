import { boolean, snakeCase, text, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../../infra/database/columns.js";
import { users } from "../users/users.table.js";

/** The column defaults, and GET's answer before the first change. */
export const settingsDefaults = { theme: "system", notificationsEnabled: true } as const;

export const settings = snakeCase.table("settings", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text({ enum: ["system", "light", "dark"] })
    .notNull()
    .default(settingsDefaults.theme),
  notificationsEnabled: boolean().notNull().default(settingsDefaults.notificationsEnabled),
  ...timestamps,
});
