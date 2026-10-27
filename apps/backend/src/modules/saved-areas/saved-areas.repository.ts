import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { CreateSavedAreaBody, SavedArea, UpdateSavedAreaBody } from "@repo/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { savedAreas } from "./saved-areas.table.js";

// Every query names the owner, so another user's area matches no row: no ownership check to forget.
@Injectable()
export class SavedAreasRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findPage(userId: string, limit: number, offset: number): Promise<{ items: SavedArea[]; total: number }> {
    const owned = eq(savedAreas.userId, userId);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(savedAreas)
        .where(owned)
        .orderBy(desc(savedAreas.createdAt), desc(savedAreas.id))
        .limit(limit)
        .offset(offset),
      this.db.$count(savedAreas, owned),
    ]);
    return { items: rows.map(toSavedArea), total };
  }

  async insert(userId: string, { name, area }: CreateSavedAreaBody): Promise<SavedArea> {
    const [row] = await this.db
      .insert(savedAreas)
      .values({ userId, name, ...area })
      .returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toSavedArea(row);
  }

  async update(userId: string, id: string, changes: UpdateSavedAreaBody): Promise<SavedArea | undefined> {
    const [row] = await this.db
      .update(savedAreas)
      .set(changes)
      .where(and(eq(savedAreas.userId, userId), eq(savedAreas.id, id)))
      .returning();
    return row && toSavedArea(row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(savedAreas)
      .where(and(eq(savedAreas.userId, userId), eq(savedAreas.id, id)))
      .returning({ id: savedAreas.id });
    return rows.length > 0;
  }
}

function toSavedArea(row: typeof savedAreas.$inferSelect): SavedArea {
  return {
    id: row.id,
    name: row.name,
    area: { west: row.west, south: row.south, east: row.east, north: row.north },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
