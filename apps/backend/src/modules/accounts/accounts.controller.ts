import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createUserBodySchema,
  idParamsSchema,
  setUserStatusBodySchema,
  setUserTierBodySchema,
  updateUserBodySchema,
  userListQuerySchema,
  userPageSchema,
  userSchema,
  type CreateUserBody,
  type IdParams,
  type SetUserStatusBody,
  type SetUserTierBody,
  type UpdateUserBody,
  type User,
  type UserListQuery,
  type UserPage,
} from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { AccountsService } from "./accounts.service.js";

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

// Admin-only: the guard's default, since no handler declares @Roles.
@Controller("admin/users")
export class AccountsAdminController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @Serialize(userPageSchema)
  list(@Query({ schema: userListQuerySchema }) query: UserListQuery): Promise<UserPage> {
    return this.accounts.list(query);
  }

  @Get(":id")
  @Serialize(userSchema)
  get(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<User> {
    return this.accounts.get(id);
  }

  @Post()
  @Serialize(userSchema)
  create(@Body({ schema: createUserBodySchema }) body: CreateUserBody): Promise<User> {
    return this.accounts.create(body);
  }

  @Patch(":id")
  @Serialize(userSchema)
  update(
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: updateUserBodySchema }) body: UpdateUserBody,
  ): Promise<User> {
    return this.accounts.update(id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() caller: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.accounts.remove(id, caller.userId);
  }

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
}
