import { setTimeout as sleep } from "node:timers/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { ModelClient, ModelUnavailableError, type ModelReply, type ModelRequest } from "./model.client.js";

/**
 * Stands in for the chat model with a fixed script, so a chat runs end to end without Bedrock. Like a real model it
 * reads only the request. `[fail]` in the user's words makes it fail as an unreachable model does, `[refuse]` refuse.
 */
@Injectable()
export class ScriptedModel extends ModelClient {
  private readonly delayMs: number;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.delayMs = config.get("SCRIPTED_MODEL_DELAY_MS", { infer: true });
  }

  async reply(request: ModelRequest): Promise<ModelReply> {
    if (this.delayMs > 0) await sleep(this.delayMs);
    return scriptedReply(request);
  }
}

export function scriptedReply(request: ModelRequest): ModelReply {
  const words = latestUserWords(request.messages);
  if (words.includes("[fail]")) throw new ModelUnavailableError("The scripted model was told to fail");
  if (words.includes("[refuse]")) return replyWith(request, [], "refusal");
  return replyWith(request, [text(`You said: "${words}". ${areaNote(request.messages)}`)], "end_turn");
}

function replyWith(
  request: ModelRequest,
  content: Anthropic.ContentBlockParam[],
  stopReason: Anthropic.StopReason,
): ModelReply {
  return {
    content,
    stopReason,
    // About four characters a token, which is all a stand-in needs for turn records and spend limits.
    usage: {
      inputTokens: Math.ceil(JSON.stringify(request).length / 4),
      outputTokens: Math.ceil(JSON.stringify(content).length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

function text(value: string): Anthropic.TextBlockParam {
  return { type: "text", text: value };
}

// The app's own blocks in a user message, such as the map context, are tagged; the user's words are not.
function isAppBlock(value: string): boolean {
  return /^<[a-z_]+>/.test(value);
}

function textBlocks(message: Anthropic.MessageParam): string[] {
  if (typeof message.content === "string") return [message.content];
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
}

function latestUserWords(messages: Anthropic.MessageParam[]): string {
  for (const message of messages.toReversed()) {
    if (message.role !== "user") continue;
    const words = textBlocks(message).filter((block) => !isAppBlock(block));
    if (words.length > 0) return words.join("\n");
  }
  return "";
}

function areaNote(messages: Anthropic.MessageParam[]): string {
  const context = messages
    .flatMap((message) => (message.role === "user" ? textBlocks(message) : []))
    .findLast((block) => block.startsWith("<map_context>"));
  const size = context && /([\d.]+ km²)/.exec(context)?.[1];
  return size ? `I can see the area you selected (${size}).` : "No area is selected on the map.";
}
