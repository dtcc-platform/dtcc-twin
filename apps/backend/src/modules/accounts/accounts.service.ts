import { ConflictException, Injectable } from "@nestjs/common";
import type {
  CreateUserBody,
  SetUserStatusBody,
  Tier,
  UpdateUserBody,
  User,
  UserListQuery,
  UserPage,
} from "@repo/contracts";
import { AuthService } from "../auth/auth.service.js";
import { KeysService } from "../keys/keys.service.js";
import { UsersService } from "../users/users.service.js";

@Injectable()
export class AccountsService {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly keys: KeysService,
  ) {}

  list(query: UserListQuery): Promise<UserPage> {
    return this.users.list(query);
  }

  get(id: string): Promise<User> {
    return this.users.get(id);
  }

  create(body: CreateUserBody): Promise<User> {
    return this.users.create(body);
  }

  update(id: string, changes: UpdateUserBody): Promise<User> {
    return this.users.update(id, changes);
  }

  async setStatus(id: string, status: SetUserStatusBody["status"], callerId: string): Promise<User> {
    if (id === callerId) throw new ConflictException("Admins cannot change their own status");
    if (status === "disabled") {
      await this.users.ensureNotLastActiveAdmin(await this.users.get(id));
      // Before the status: if the gateway fails, nothing has changed and a retry does it all.
      await this.keys.revokeAll(id);
    }

    const user = await this.users.setStatus(id, status);
    // Also when already disabled, so retrying a disable that failed halfway finishes it.
    if (status === "disabled") await this.auth.logoutAll(id);
    return user;
  }

  setTier(id: string, tier: Tier): Promise<User> {
    return this.users.setTier(id, tier);
  }

  async remove(id: string, callerId: string): Promise<void> {
    if (id === callerId) throw new ConflictException("Admins cannot delete themselves");
    await this.users.ensureNotLastActiveAdmin(await this.users.get(id));
    await this.keys.revokeAll(id);
    await this.users.remove(id);
  }
}
