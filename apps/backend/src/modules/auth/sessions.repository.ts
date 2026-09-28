import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { sessions, userAgentMaxLength } from "./sessions.table.js";
import { sessionLifetimeSeconds } from "./tokens/lifetimes.js";

// The database clock, like every comparison below, so the app's clock never matters.
const expiresFromNow = sql`now() + make_interval(secs => ${sessionLifetimeSeconds})`;

export type SessionRow = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
};

@Injectable()
export class SessionsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async insert(userId: string, refreshTokenHash: string, userAgent: string | undefined): Promise<string> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        userId,
        refreshTokenHash,
        userAgent: userAgent?.slice(0, userAgentMaxLength),
        expiresAt: expiresFromNow,
      })
      .returning({ id: sessions.id });
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return row.id;
  }

  async findAll(userId: string): Promise<SessionRow[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)))
      .orderBy(desc(sessions.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.updatedAt.toISOString(),
    }));
  }

  async extend(refreshTokenHash: string): Promise<{ id: string; userId: string } | undefined> {
    const [row] = await this.db
      .update(sessions)
      .set({ expiresAt: expiresFromNow })
      .where(and(eq(sessions.refreshTokenHash, refreshTokenHash), gt(sessions.expiresAt, sql`now()`)))
      .returning({ id: sessions.id, userId: sessions.userId });
    return row;
  }

  /** Scoped to the user, so nobody can end another user's session by its id. */
  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, id)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async deleteByRefreshTokenHash(refreshTokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.refreshTokenHash, refreshTokenHash));
  }

  async deleteAll(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async deleteExpired(userId: string): Promise<void> {
    await this.db.delete(sessions).where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, sql`now()`)));
  }
}
