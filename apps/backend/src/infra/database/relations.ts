import { defineRelations } from "drizzle-orm";
import { sessions } from "../../modules/auth/sessions.table.js";
import { items } from "../../modules/items/items.table.js";
import { settings } from "../../modules/settings/settings.table.js";
import { users } from "../../modules/users/users.table.js";

// Add every new table here, even one without relations, or `db.query.<table>` won't exist.
export const relations = defineRelations({ users, settings, items, sessions }, (r) => ({
  users: {
    settings: r.one.settings({ from: r.users.id, to: r.settings.userId }),
    // `many` infers its columns from the matching `one` below.
    items: r.many.items(),
    sessions: r.many.sessions(),
  },
  settings: {
    user: r.one.users({ from: r.settings.userId, to: r.users.id, optional: false }),
  },
  items: {
    user: r.one.users({ from: r.items.userId, to: r.users.id, optional: false }),
  },
  sessions: {
    user: r.one.users({ from: r.sessions.userId, to: r.users.id, optional: false }),
  },
}));
