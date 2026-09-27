import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { CreateItemBody, Item, UpdateItemBody } from "@repo/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { items } from "./items.table.js";

// Every query names the owner, so another user's item matches no row: no ownership check to forget.
@Injectable()
export class ItemsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findPage(userId: string, limit: number, offset: number): Promise<{ items: Item[]; total: number }> {
    const owned = eq(items.userId, userId);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(items)
        .where(owned)
        .orderBy(asc(items.createdAt), asc(items.id))
        .limit(limit)
        .offset(offset),
      this.db.$count(items, owned),
    ]);
    return { items: rows.map(toItem), total };
  }

  async findById(userId: string, id: string): Promise<Item | undefined> {
    const [row] = await this.db
      .select()
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.id, id)));
    return row && toItem(row);
  }

  async insert(userId: string, values: CreateItemBody): Promise<Item> {
    const [row] = await this.db
      .insert(items)
      .values({ ...values, userId })
      .returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toItem(row);
  }

  async update(userId: string, id: string, changes: UpdateItemBody): Promise<Item | undefined> {
    // Drizzle rejects an empty SET, and an empty PATCH changes nothing.
    if (Object.keys(changes).length === 0) return this.findById(userId, id);
    const [row] = await this.db
      .update(items)
      .set(changes)
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning();
    return row && toItem(row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(items)
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning({ id: items.id });
    return rows.length > 0;
  }
}

function toItem(row: typeof items.$inferSelect): Item {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
