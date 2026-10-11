import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Put } from "@nestjs/common";
import {
  idParamsSchema,
  setUserStatusBodySchema,
  setUserTierBodySchema,
  userSchema,
  type IdParams,
  type SetUserStatusBody,
  type SetUserTierBody,
  type User,
} from "@repo/contracts";
import { CurrentUser, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { AccountsService } from "./accounts.service.js";

// Admin-only. Under /users beside UsersController, which keeps the plain reads and profile edits.
@Controller("users")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Put(":id/status")
  @Serialize(userSchema)
  setStatus(
    @CurrentUser() caller: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: setUserStatusBodySchema }) { status }: SetUserStatusBody,
  ): Promise<User> {
    return this.accounts.setStatus(id, status, caller.userId);
  }

  @Put(":id/tier")
  @Serialize(userSchema)
  setTier(
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: setUserTierBodySchema }) { tier }: SetUserTierBody,
  ): Promise<User> {
    return this.accounts.setTier(id, tier);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() caller: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.accounts.remove(id, caller.userId);
  }
}
