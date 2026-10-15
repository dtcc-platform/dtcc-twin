import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import {
  apiKeyListSchema,
  createApiKeyBodySchema,
  createdApiKeySchema,
  idParamsSchema,
  userKeyParamsSchema,
  type ApiKeyList,
  type CreateApiKeyBody,
  type CreatedApiKey,
  type IdParams,
  type UserKeyParams,
} from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { KeysService } from "./keys.service.js";

@Controller("keys")
@Roles("user")
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  @Get()
  @Serialize(apiKeyListSchema)
  list(@CurrentUser() user: AuthUser): Promise<ApiKeyList> {
    return this.keys.list(user.userId);
  }

  @Post()
  @Serialize(createdApiKeySchema)
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createApiKeyBodySchema }) body: CreateApiKeyBody,
  ): Promise<CreatedApiKey> {
    return this.keys.create(user.userId, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.keys.revoke(user.userId, id);
  }
}

// Admin-only: the guard's default, since no handler declares @Roles.
@Controller("admin/users/:id/keys")
export class KeysAdminController {
  constructor(private readonly keys: KeysService) {}

  @Get()
  @Serialize(apiKeyListSchema)
  list(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<ApiKeyList> {
    return this.keys.listForUser(id);
  }

  @Delete(":keyId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param({ schema: userKeyParamsSchema }) { id, keyId }: UserKeyParams): Promise<void> {
    return this.keys.revoke(id, keyId);
  }
}
