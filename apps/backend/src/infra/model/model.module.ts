import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfigService } from "../../config/env.schema.js";
import { ModelClient } from "./model.client.js";
import { ScriptedModelClient } from "./scripted.model-client.js";

@Module({
  providers: [
    {
      provide: ModelClient,
      inject: [ConfigService],
      useFactory: async (config: EnvConfigService) => {
        switch (config.get("AGENT_MODEL_PROVIDER", { infer: true })) {
          // Imported lazily: loading the Bedrock SDK eagerly fails under Vitest (Smithy's extensionless ESM imports).
          case "bedrock": {
            const { BedrockModelClient } = await import("./bedrock.model-client.js");
            return new BedrockModelClient(config);
          }
          case "anthropic": {
            const { AnthropicModelClient } = await import("./anthropic.model-client.js");
            return new AnthropicModelClient(config);
          }
          case "scripted":
            return new ScriptedModelClient();
        }
      },
    },
  ],
  exports: [ModelClient],
})
export class ModelModule {}
