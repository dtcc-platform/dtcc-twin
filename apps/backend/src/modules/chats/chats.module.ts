import { Module } from "@nestjs/common";
import { ModelModule } from "../../infra/model/model.module.js";
import { UsersModule } from "../users/users.module.js";
import { ChatTurnRunner } from "./chat-turns.js";
import { ChatsController } from "./chats.controller.js";
import { ChatsRepository } from "./chats.repository.js";
import { ChatsService } from "./chats.service.js";

@Module({
  imports: [ModelModule, UsersModule],
  controllers: [ChatsController],
  providers: [ChatsService, ChatsRepository, ChatTurnRunner],
})
export class ChatsModule {}
