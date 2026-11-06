import type Anthropic from "@anthropic-ai/sdk";

/** One Messages API request: the conversation so far, with the system prompt and the tools the model may call. */
export type ModelRequest = {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type ModelReply = {
  /** Stored and sent back unchanged on every later request, thinking blocks included. */
  content: Anthropic.ContentBlockParam[];
  stopReason: Anthropic.StopReason | null;
  usage: ModelUsage;
};

/**
 * The chat model, and the only code that talks to a model provider. `ScriptedModel` stands in until the Bedrock
 * adapter exists; both answer the same requests in the Messages API's shapes.
 */
export abstract class ModelClient {
  /** Throws when no answer came back: the provider is unreachable, throttled or failing. */
  abstract reply(request: ModelRequest): Promise<ModelReply>;
}

export class ModelUnavailableError extends Error {}
