import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createUserBodySchema,
  idParamsSchema,
  offsetPaginationQuerySchema,
  updateUserBodySchema,
  userPageSchema,
  userSchema,
  type CreateUserBody,
  type IdParams,
  type OffsetPaginationQuery,
  type UpdateUserBody,
  type User,
  type UserPage,
} from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { UsersService } from "./users.service.js";

// Admin-only, except the logged-in user's own `me`.
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Serialize(userPageSchema)
  list(@Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery): Promise<UserPage> {
    return this.users.list(query);
  }

  @Get(":id")
  @Serialize(userSchema)
  get(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<User> {
    return this.users.get(id);
  }

  @Post()
  @Serialize(userSchema)
  create(@Body({ schema: createUserBodySchema }) body: CreateUserBody): Promise<User> {
    return this.users.create(body);
  }

  // Before `:id`, or Express reads "me" as an id.
  @Patch("me")
  @Roles("user")
  @Serialize(userSchema)
  updateMe(@CurrentUser() user: AuthUser, @Body({ schema: updateUserBodySchema }) body: UpdateUserBody): Promise<User> {
    return this.users.update(user.userId, body);
  }

  @Patch(":id")
  @Serialize(userSchema)
  update(
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: updateUserBodySchema }) body: UpdateUserBody,
  ): Promise<User> {
    return this.users.update(id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.users.remove(id);
  }
}
