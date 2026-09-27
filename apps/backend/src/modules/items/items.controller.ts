import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createItemBodySchema,
  idParamsSchema,
  itemPageSchema,
  itemSchema,
  offsetPaginationQuerySchema,
  updateItemBodySchema,
  type CreateItemBody,
  type IdParams,
  type Item,
  type ItemPage,
  type OffsetPaginationQuery,
  type UpdateItemBody,
} from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { ItemsService } from "./items.service.js";

// The logged-in user's own items; nobody, admins included, reaches another user's here.
@Controller("items")
@Roles("user")
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @Serialize(itemPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery,
  ): Promise<ItemPage> {
    return this.items.list(user.userId, query);
  }

  @Get(":id")
  @Serialize(itemSchema)
  get(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<Item> {
    return this.items.get(user.userId, id);
  }

  @Post()
  @Serialize(itemSchema)
  create(@CurrentUser() user: AuthUser, @Body({ schema: createItemBodySchema }) body: CreateItemBody): Promise<Item> {
    return this.items.create(user.userId, body);
  }

  @Patch(":id")
  @Serialize(itemSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: updateItemBodySchema }) body: UpdateItemBody,
  ): Promise<Item> {
    return this.items.update(user.userId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.items.remove(user.userId, id);
  }
}
