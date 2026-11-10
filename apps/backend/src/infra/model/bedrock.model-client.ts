import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { providerFailure } from "./model.failure.js";
import { ModelClient, type ModelReply, type ModelRequest } from "./model.client.js";

@Injectable()
export class BedrockModelClient extends ModelClient {
  private readonly logger = new Logger(BedrockModelClient.name);
  private readonly secret: string | undefined;
  readonly provider = "bedrock";
  readonly model: string;
  private readonly client: AnthropicBedrock;
  constructor(config: ConfigService<Env, true>) {
    super();
    this.secret = config.get("AWS_BEARER_TOKEN_BEDROCK", { infer: true });
    this.model = config.get("AGENT_MODEL", "eu.anthropic.claude-sonnet-5-5", { infer: true });
    this.client = new AnthropicBedrock({
      awsRegion: config.get("AGENT_BEDROCK_REGION", { infer: true }),
      apiKey: config.get("AWS_BEARER_TOKEN_BEDROCK", { infer: true }) ?? null,
    });
  }
  async reply(
    request: ModelRequest,
    opts: { signal: AbortSignal; onText: (delta: string) => void },
  ): Promise<ModelReply> {
    try {
      const stream = this.client.messages
        .stream(
          {
            ...request,
            model: this.model,
            max_tokens: 4096,
            thinking: { type: "adaptive" },
            output_config: { effort: "low" },
            tool_choice: { type: "auto" },
          },
          { signal: opts.signal },
        )
        .on("text", opts.onText);
      const reply = await stream.finalMessage();
      return {
        content: reply.content,
        stopReason: reply.stop_reason,
        usage: {
          inputTokens: reply.usage.input_tokens,
          outputTokens: reply.usage.output_tokens,
          cacheReadTokens: reply.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: reply.usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (error) {
      opts.signal.throwIfAborted();
      throw providerFailure(this.provider, error, this.secret, this.logger);
    }
  }
}
