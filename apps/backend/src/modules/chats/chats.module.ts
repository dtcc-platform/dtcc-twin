import { Module } from "@nestjs/common";
import { ModelModule } from "../../infra/model/model.module.js";
import { DatasetsModule } from "../datasets/datasets.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { UsersModule } from "../users/users.module.js";
import { ChatTools } from "./chat-tools.js";
import { ChatTurnRunner } from "./chat-turns.js";
import { ChatsController } from "./chats.controller.js";
import { ChatsRepository } from "./chats.repository.js";
import { ChatsService } from "./chats.service.js";
import { ChatsWatcher } from "./chats.watcher.js";

@Module({
  imports: [ModelModule, UsersModule, JobsModule, DatasetsModule],
  controllers: [ChatsController],
  providers: [ChatsService, ChatsRepository, ChatTurnRunner, ChatTools, ChatsWatcher],
})
export class ChatsModule {}
