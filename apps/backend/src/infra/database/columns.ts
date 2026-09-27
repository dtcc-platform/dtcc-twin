import { sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";

/** Spread into every table: `...timestamps`. Raw SQL updates must set `updatedAt` themselves. */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};
