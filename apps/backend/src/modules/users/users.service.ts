import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateUserBody, OffsetPaginationQuery, UpdateUserBody, User, UserPage } from "@repo/contracts";
import { hashPassword, verifyPassword, verifyUnknownUser } from "./password.js";
import { UsersRepository } from "./users.repository.js";

/** Other modules reach users through this service, never the repository. */
@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async list({ limit, offset }: OffsetPaginationQuery): Promise<UserPage> {
    const { items, total } = await this.repository.findPage(limit, offset);
    return { items, limit, offset, total };
  }

  async get(id: string): Promise<User> {
    const user = await this.repository.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  // A taken email answers 409 through the unique index.
  async create({ password, ...profile }: CreateUserBody): Promise<User> {
    const passwordHash = await hashPassword(password);
    return this.repository.insert({ ...profile, passwordHash });
  }

  /** Undefined for a wrong email and a wrong password alike. */
  async verifyCredentials(email: string, password: string): Promise<User | undefined> {
    const credentials = await this.repository.findCredentials(email);
    if (!credentials) {
      await verifyUnknownUser(password);
      return undefined;
    }

    const matches = await verifyPassword(credentials.passwordHash, password);
    if (!matches) return undefined;
    return credentials.user;
  }

  async update(id: string, changes: UpdateUserBody): Promise<User> {
    const user = await this.repository.update(id, changes);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async remove(id: string): Promise<void> {
    // Settings and items go with the user: their foreign keys cascade.
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new NotFoundException(`User ${id} not found`);
  }
}
