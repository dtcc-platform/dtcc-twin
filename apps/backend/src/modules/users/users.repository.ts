import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { UpdateUserBody, User } from "@repo/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";
import { users } from "./users.table.js";

@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findPage(limit: number, offset: number): Promise<{ items: User[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db.select().from(users).orderBy(asc(users.createdAt), asc(users.id)).limit(limit).offset(offset),
      this.db.$count(users),
    ]);
    return { items: rows.map(toUser), total };
  }

  async findById(id: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row && toUser(row);
  }

  /** The only read that returns the hash; every other one maps through toUser, which drops it. */
  async findCredentials(email: string): Promise<{ user: User; passwordHash: string } | undefined> {
    // The unique index's expression, so the lookup uses it and ignores case.
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    return row && { user: toUser(row), passwordHash: row.passwordHash };
  }

  async insert(values: NewUser): Promise<User> {
    const [row] = await this.db.insert(users).values(values).returning();
    if (!row) throw new Error("INSERT … RETURNING returned no row");
    return toUser(row);
  }

  async update(id: string, changes: UpdateUserBody): Promise<User | undefined> {
    // Drizzle rejects an empty SET, and an empty PATCH changes nothing.
    if (Object.keys(changes).length === 0) return this.findById(id);
    const [row] = await this.db.update(users).set(changes).where(eq(users.id, id)).returning();
    return row && toUser(row);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return rows.length > 0;
  }
}

type NewUser = Pick<typeof users.$inferInsert, "email" | "name" | "passwordHash" | "role">;

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
