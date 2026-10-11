import { Body, Controller, Patch } from "@nestjs/common";
import { updateUserBodySchema, userSchema, type UpdateUserBody, type User } from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { AccountsService } from "./accounts.service.js";

// The caller's own account. Admins act on other users through AccountsAdminController.
@Controller("users")
@Roles("user")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Patch("me")
  @Serialize(userSchema)
  updateMe(@CurrentUser() user: AuthUser, @Body({ schema: updateUserBodySchema }) body: UpdateUserBody): Promise<User> {
    return this.accounts.update(user.userId, body);
  }
}
