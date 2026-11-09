import type Anthropic from "@anthropic-ai/sdk";
export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
export type ModelRequest = {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
};
export type ModelReply = {
  content: Anthropic.ContentBlockParam[];
  stopReason: Anthropic.StopReason | null;
  usage: ModelUsage;
};
export class ModelUnavailableError extends Error {
  constructor(
    message: string,
    readonly errorCode = "agent_unavailable",
  ) {
    super(message);
  }
}
export abstract class ModelClient {
  abstract readonly provider: string;
  abstract readonly model: string;
  abstract reply(
    request: ModelRequest,
    opts: { signal: AbortSignal; onText: (delta: string) => void },
  ): Promise<ModelReply>;
}
