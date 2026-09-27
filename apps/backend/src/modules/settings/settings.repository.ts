import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Settings, UpdateSettingsBody } from "@repo/contracts";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { settings } from "./settings.table.js";

@Injectable()
export class SettingsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findByUserId(userId: string): Promise<Settings | undefined> {
    const [row] = await this.db.select().from(settings).where(eq(settings.userId, userId));
    return row && toSettings(row);
  }

  async upsert(userId: string, changes: UpdateSettingsBody): Promise<Settings> {
    const [row] = await this.db
      .insert(settings)
      .values({ userId, ...changes })
      // `updatedAt` by hand keeps the SET list non-empty when the body is `{}`.
      .onConflictDoUpdate({ target: settings.userId, set: { ...changes, updatedAt: sql`now()` } })
      .returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toSettings(row);
  }
}

function toSettings(row: typeof settings.$inferSelect): Settings {
  return { userId: row.userId, theme: row.theme, notificationsEnabled: row.notificationsEnabled };
}
