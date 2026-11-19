import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { providerFailure } from "./model.failure.js";
import { ModelClient, ModelUnavailableError, type ModelReply, type ModelRequest } from "./model.client.js";

@Injectable()
export class AnthropicModelClient extends ModelClient {
  private readonly logger = new Logger(AnthropicModelClient.name);
  private readonly secret: string | undefined;
  readonly provider = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  constructor(config: ConfigService<Env, true>) {
    super();
    this.secret = config.get("ANTHROPIC_API_KEY", { infer: true });
    this.model = config.get("AGENT_MODEL", "claude-sonnet-5-5", { infer: true });
    this.client = new Anthropic({ apiKey: config.get("ANTHROPIC_API_KEY", { infer: true }) ?? null });
  }
  async reply(
    request: ModelRequest,
    opts: { signal: AbortSignal; onText: (delta: string) => void },
  ): Promise<ModelReply> {
    try {
      const reply = await this.client.beta.messages
        .stream(
          {
            ...request,
            model: this.model,
            max_tokens: 4096,
            thinking: { type: "adaptive" },
            output_config: { effort: "low" },
            tool_choice: { type: "auto" },
            fallbacks: "default",
            betas: ["server-side-fallback-2026-07-01"],
          },
          { signal: opts.signal },
        )
        .on("text", opts.onText)
        .finalMessage();
      const content = reply.content.filter(
        (block) =>
          block.type === "text" ||
          block.type === "thinking" ||
          block.type === "redacted_thinking" ||
          block.type === "tool_use",
      );
      if (content.length !== reply.content.length || reply.stop_reason === "compaction")
        throw new ModelUnavailableError("Unsupported provider response");
      return {
        content,
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
