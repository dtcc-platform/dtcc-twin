import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import {
  chatMessageBodySchema,
  chatPageSchema,
  chatSchema,
  idParamsSchema,
  offsetPaginationQuerySchema,
  type Chat,
  type ChatMessageBody,
  type ChatPage,
  type IdParams,
  type OffsetPaginationQuery,
} from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { ChatsService } from "./chats.service.js";

// The logged-in user's own chats; nobody, admins included, reaches another user's here.
@Controller("chats")
@Roles("user")
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  @Serialize(chatPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery,
  ): Promise<ChatPage> {
    return this.chats.list(user.userId, query);
  }

  // Answers once the assistant has: the turn runs within the request.
  @Post()
  @Serialize(chatSchema)
  create(@CurrentUser() user: AuthUser, @Body({ schema: chatMessageBodySchema }) body: ChatMessageBody): Promise<Chat> {
    return this.chats.create(user.userId, body);
  }

  @Get(":id")
  @Serialize(chatSchema)
  get(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<Chat> {
    return this.chats.get(user.userId, id);
  }

  @Post(":id/messages")
  @Serialize(chatSchema)
  post(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: chatMessageBodySchema }) body: ChatMessageBody,
  ): Promise<Chat> {
    return this.chats.post(user.userId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.chats.remove(user.userId, id);
  }
}
