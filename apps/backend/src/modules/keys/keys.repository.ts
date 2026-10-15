import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { ApiKey, CreateApiKeyBody } from "@repo/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { apiKeys } from "./keys.table.js";

@Injectable()
export class KeysRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findAll(userId: string): Promise<ApiKey[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));
    return rows.map(toApiKey);
  }

  async findById(userId: string, id: string): Promise<ApiKey | undefined> {
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.id, id)));
    return row && toApiKey(row);
  }

  count(userId: string): Promise<number> {
    return this.db.$count(apiKeys, eq(apiKeys.userId, userId));
  }

  async insert(userId: string, values: CreateApiKeyBody & { prefix: string }): Promise<ApiKey> {
    const [row] = await this.db
      .insert(apiKeys)
      .values({ ...values, userId })
      .returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toApiKey(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.id, id)));
  }

  async deleteAll(userId: string): Promise<void> {
    await this.db.delete(apiKeys).where(eq(apiKeys.userId, userId));
  }
}

function toApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
  };
}
