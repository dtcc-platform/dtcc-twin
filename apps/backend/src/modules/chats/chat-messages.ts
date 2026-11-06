import type Anthropic from "@anthropic-ai/sdk";
import type { Bounds, ChatEntry } from "@repo/contracts";

export const chatMessageKinds = ["user_message", "assistant", "tool_results", "notice"] as const;
export type ChatMessageKind = (typeof chatMessageKinds)[number];

/**
 * A message to store. `content` is exactly what the model was sent or answered, replayed unchanged on every later turn
 * so the prompt cache and thinking blocks stay valid; `data` is what the transcript shows when `content` isn't for
 * people. A notice is for people only and never reaches the model.
 */
export type NewChatMessage = UserMessage | AssistantMessage | ToolResults | Notice;
export type UserMessage = {
  kind: "user_message";
  content: Anthropic.TextBlockParam[];
  data: { text: string; bounds: Bounds | null };
};
export type AssistantMessage = { kind: "assistant"; content: Anthropic.ContentBlockParam[]; data: null };
export type ToolResults = {
  kind: "tool_results";
  content: Anthropic.ToolResultBlockParam[];
  data: { calls: ToolCall[] };
};
export type Notice = { kind: "notice"; content: null; data: { text: string } };

/** One tool call the assistant made, as the transcript shows it. */
export type ToolCall = {
  toolUseId: string;
  tool: string;
  /** The Dataset a `run_` tool ran, or null for any other tool. */
  dataset: string | null;
  /** The job the call started, or null when it started none. */
  jobId: string | null;
};

export type ChatMessage = NewChatMessage & { id: string; seq: number; createdAt: string };

/** The user's words, after the app's note of the area selected on the map when they were sent. */
export function userMessage(text: string, bounds: Bounds | null): UserMessage {
  return {
    kind: "user_message",
    content: [
      { type: "text", text: mapContext(bounds) },
      { type: "text", text },
    ],
    data: { text, bounds },
  };
}

export function assistantMessage(content: Anthropic.ContentBlockParam[]): AssistantMessage {
  return { kind: "assistant", content, data: null };
}

/** The results of every tool call in one assistant message, which the model must get together in one message. */
export function toolResults(results: { block: Anthropic.ToolResultBlockParam; call: ToolCall }[]): ToolResults {
  return {
    kind: "tool_results",
    content: results.map(({ block }) => block),
    data: { calls: results.map(({ call }) => call) },
  };
}

export function notice(text: string): Notice {
  return { kind: "notice", content: null, data: { text } };
}

/** The conversation as the model sees it: every message in order, exactly as stored, without notices. */
export function toModelMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.flatMap((message) => toModelMessage(message) ?? []);
}

/** One message as the model sees it, or null for a notice, which only people see. */
export function toModelMessage(message: NewChatMessage): Anthropic.MessageParam | null {
  switch (message.kind) {
    case "user_message":
    case "tool_results":
      return { role: "user", content: message.content };
    case "assistant":
      return { role: "assistant", content: message.content };
    case "notice":
      return null;
  }
}

/** The conversation as the transcript shows it. */
export function toEntries(messages: ChatMessage[]): ChatEntry[] {
  return messages.flatMap((message): ChatEntry[] => {
    const { id, createdAt } = message;
    switch (message.kind) {
      case "user_message":
        return [{ id, createdAt, type: "user", text: message.data.text, bounds: message.data.bounds }];
      case "assistant": {
        const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
        return text ? [{ id, createdAt, type: "assistant", text }] : [];
      }
      case "tool_results":
        return message.data.calls.flatMap((call, index): ChatEntry[] =>
          call.jobId && call.dataset
            ? [{ id: `${id}:${String(index)}`, createdAt, type: "job", jobId: call.jobId, dataset: call.dataset }]
            : [],
        );
      case "notice":
        return [{ id, createdAt, type: "notice", text: message.data.text }];
    }
  });
}

function mapContext(bounds: Bounds | null): string {
  if (!bounds) return "<map_context>No area is selected on the map.</map_context>";
  const [minX, minY, maxX, maxY] = bounds;
  const squareKilometres = ((maxX - minX) * (maxY - minY)) / 1_000_000;
  return `<map_context>Selected area: EPSG:3006 bounds [${bounds.join(", ")}], ${squareKilometres.toFixed(2)} km².</map_context>`;
}
