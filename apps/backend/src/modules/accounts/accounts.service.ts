import { ConflictException, Injectable } from "@nestjs/common";
import type { SetUserStatusBody, Tier, User } from "@repo/contracts";
import { AuthService } from "../auth/auth.service.js";
import { UsersService } from "../users/users.service.js";

/** Status, tier and deletion, which reach beyond the users table: sessions now, the gateway's consumers next. */
@Injectable()
export class AccountsService {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  async setStatus(id: string, status: SetUserStatusBody["status"], callerId: string): Promise<User> {
    if (id === callerId) throw new ConflictException("Admins cannot change their own status");
    if (status === "disabled") await this.users.ensureNotLastActiveAdmin(await this.users.get(id));

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
    await this.users.remove(id);
  }
}
