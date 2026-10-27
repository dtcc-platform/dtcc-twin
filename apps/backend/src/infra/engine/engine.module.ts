import { Module } from "@nestjs/common";
import { EngineClient } from "./engine.client.js";

@Module({
  providers: [EngineClient],
  exports: [EngineClient],
})
export class EngineModule {}
