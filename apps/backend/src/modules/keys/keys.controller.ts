import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import {
  apiKeyListSchema,
  createApiKeyBodySchema,
  createdApiKeySchema,
  idParamsSchema,
  type ApiKeyList,
  type CreateApiKeyBody,
  type CreatedApiKey,
  type IdParams,
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
