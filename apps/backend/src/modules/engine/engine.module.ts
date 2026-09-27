import { Module } from "@nestjs/common";
import { EngineClient } from "./engine.client.js";
import { FakeEngineClient } from "./fake-engine.client.js";

@Module({
  providers: [{ provide: EngineClient, useClass: FakeEngineClient }],
  exports: [EngineClient],
})
export class EngineModule {}
