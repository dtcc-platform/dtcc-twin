import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateUserBody,
  RegisterBody,
  Tier,
  UpdateUserBody,
  User,
  UserListQuery,
  UserPage,
  UserStatus,
} from "@repo/contracts";
import { hashPassword, verifyPassword, verifyUnknownUser } from "./password.js";
import { UsersRepository } from "./users.repository.js";

/** Other modules reach users through this service, never the repository. */
@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async list({ limit, offset, status }: UserListQuery): Promise<UserPage> {
    const { items, total } = await this.repository.findPage(limit, offset, status);
    return { items, limit, offset, total };
  }

  async get(id: string): Promise<User> {
    const user = await this.repository.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /** An admin creating a user, who needs no approval. A taken email answers 409 through the unique index. */
  async create({ password, ...profile }: CreateUserBody): Promise<User> {
    const passwordHash = await hashPassword(password);
    return this.repository.insert({ ...profile, passwordHash, status: "active" });
  }

  /** Self sign-up: pending until an admin approves. */
  async register({ password, ...profile }: RegisterBody): Promise<User> {
    const passwordHash = await hashPassword(password);
    return this.repository.insert({ ...profile, passwordHash, status: "pending" });
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

  update(id: string, changes: UpdateUserBody): Promise<User> {
    return this.apply(id, changes);
  }

  /** Writes the column only. Call it through AccountsService, which also ends sessions on disable. */
  async setStatus(id: string, status: UserStatus): Promise<User> {
    const user = await this.get(id);
    if (user.status === status) return user;
    return this.apply(id, { status });
  }

  /** Writes the column only. Call it through AccountsService. */
  async setTier(id: string, tier: Tier): Promise<User> {
    const user = await this.get(id);
    if (user.tier === tier) return user;
    return this.apply(id, { tier });
  }

  /** Refuses to disable or delete the admin the app can't do without. */
  async ensureNotLastActiveAdmin(user: User): Promise<void> {
    if (user.role !== "admin" || user.status !== "active") return;
    if ((await this.repository.countActiveAdmins()) <= 1) {
      throw new ConflictException("The last active admin cannot be disabled or deleted");
    }
  }

  /** Deletes the row only. Call it through AccountsService, which checks who may be deleted. */
  async remove(id: string): Promise<void> {
    // Settings and items go with the user: their foreign keys cascade.
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new NotFoundException(`User ${id} not found`);
  }

  private async apply(id: string, changes: UpdateUserBody & { status?: UserStatus; tier?: Tier }): Promise<User> {
    const user = await this.repository.update(id, changes);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
