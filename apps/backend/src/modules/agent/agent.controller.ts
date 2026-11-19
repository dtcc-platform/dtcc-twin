import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from "@nestjs/common";
import {
  agentEventSchema,
  askBodySchema,
  chatDetailSchema,
  chatPageSchema,
  chatSchema,
  idParamsSchema,
  offsetPaginationQuerySchema,
  updateChatBodySchema,
  type AskBody,
  type Chat,
  type ChatDetail,
  type ChatPage,
  type IdParams,
  type OffsetPaginationQuery,
  type UpdateChatBody,
} from "@repo/contracts";
import type { Response } from "express";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { StreamResponse } from "../../common/decorators/stream-response.decorator.js";
import { AgentService } from "./agent.service.js";

@Controller("agent/chats")
@Roles("user")
export class AgentController {
  constructor(private readonly agent: AgentService) {}
  @Post()
  @Serialize(chatSchema)
  create(@CurrentUser() user: AuthUser): Promise<Chat> {
    return this.agent.create(user.userId);
  }
  @Get()
  @Serialize(chatPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery,
  ): Promise<ChatPage> {
    return this.agent.list(user.userId, query);
  }
  @Get(":id")
  @Serialize(chatDetailSchema)
  get(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<ChatDetail> {
    return this.agent.get(user.userId, id);
  }
  @Patch(":id")
  @Serialize(chatSchema)
  rename(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: updateChatBodySchema }) body: UpdateChatBody,
  ): Promise<Chat> {
    return this.agent.rename(user.userId, id, body);
  }
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.agent.remove(user.userId, id);
  }
  @Post(":id/messages")
  @HttpCode(HttpStatus.OK)
  @StreamResponse(agentEventSchema)
  async ask(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: askBodySchema }) body: AskBody,
    @Res() response: Response,
  ): Promise<void> {
    const controller = new AbortController();
    const closed = (): void => {
      if (!response.writableEnded) controller.abort();
    };
    response.once("close", closed);
    try {
      await this.agent.ask(
        user.userId,
        id,
        body,
        (event) => {
          if (controller.signal.aborted) return;
          const validated = agentEventSchema.parse(event);
          if (!response.headersSent) {
            response.status(200).set({
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            });
            response.flushHeaders();
          }
          response.write(`data: ${JSON.stringify(validated)}\n\n`);
        },
        controller.signal,
      );
      response.end();
    } finally {
      response.off("close", closed);
    }
  }
}
