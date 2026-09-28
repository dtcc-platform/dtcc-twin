import type { PgAsyncDatabase, PgInsertValue, PgQueryResultHKT, PgTable } from "drizzle-orm/pg-core";
import { items } from "../src/modules/items/items.table.js";
import { settings } from "../src/modules/settings/settings.table.js";
import { hashPassword } from "../src/modules/users/password.js";
import { users } from "../src/modules/users/users.table.js";

/** Every seeded user logs in with this; seeding refuses to run in production. */
export const developmentPassword = "password";
const passwordHash = await hashPassword(developmentPassword);

// Fixed ids so rows below can refer to each other.
const ada = "00000000-0000-7000-8000-000000000001";
const alan = "00000000-0000-7000-8000-000000000002";

/** Inserted in order, so a table comes after the tables it references. Also what seeding counts and wipes. */
export const seedData = [
  rows(users, [
    { email: "admin@example.com", name: "Admin", passwordHash, role: "admin" },
    { id: ada, email: "ada@example.com", name: "Ada Lovelace", passwordHash },
    { id: alan, email: "alan@example.com", name: "Alan Turing", passwordHash },
  ]),
  // Alan has no row, so he gets the defaults.
  rows(settings, [{ userId: ada, theme: "dark", notificationsEnabled: false }]),
  rows(items, [
    { userId: ada, name: "Analytical Engine notes", description: "Note G: computing Bernoulli numbers." },
    { userId: ada, name: "Punched cards" },
    { userId: alan, name: "Enigma rotor", description: "Spare, from the Bombe." },
  ]),
];

// Types each row against its own table, so a renamed or missing column fails the typecheck.
function rows<T extends PgTable>(table: T, values: PgInsertValue<T>[]) {
  return { table, values, insert: (db: PgAsyncDatabase<PgQueryResultHKT>) => db.insert(table).values(values) };
}
