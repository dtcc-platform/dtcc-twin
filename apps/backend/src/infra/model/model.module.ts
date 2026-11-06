import { Module } from "@nestjs/common";
import { ModelClient } from "./model.client.js";
import { ScriptedModel } from "./scripted-model.js";

// The Bedrock adapter will be bound here instead, chosen by the environment.
@Module({
  providers: [{ provide: ModelClient, useClass: ScriptedModel }],
  exports: [ModelClient],
})
export class ModelModule {}
