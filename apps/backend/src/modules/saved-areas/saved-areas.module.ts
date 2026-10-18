import { Module } from "@nestjs/common";
import { SavedAreasController } from "./saved-areas.controller.js";
import { SavedAreasRepository } from "./saved-areas.repository.js";
import { SavedAreasService } from "./saved-areas.service.js";

@Module({
  controllers: [SavedAreasController],
  providers: [SavedAreasService, SavedAreasRepository],
})
export class SavedAreasModule {}
