import { describe, expect, it } from "vitest";
import {
  assistantMessage,
  notice,
  toEntries,
  toModelMessages,
  userMessage,
  type ChatMessage,
} from "./chat-messages.js";

const createdAt = "2026-11-06T10:00:00.000Z";

// Stored messages as the repository answers them: the new message plus its id, position and time.
function stored(
  ...messages: ReturnType<typeof userMessage | typeof notice | typeof assistantMessage>[]
): ChatMessage[] {
  return messages.map((message, index) => ({ ...message, id: `m${String(index)}`, seq: index + 1, createdAt }));
}

describe("userMessage", () => {
  it("tells the model the selected area before the user's words, and keeps both for the transcript", () => {
    const message = userMessage("How many trees?", [319000, 6399000, 319200, 6399200]);

    expect(message.content).toEqual([
      {
        type: "text",
        text: "<map_context>Selected area: EPSG:3006 bounds [319000, 6399000, 319200, 6399200], 0.04 km².</map_context>",
      },
      { type: "text", text: "How many trees?" },
    ]);
    expect(message.data).toEqual({ text: "How many trees?", bounds: [319000, 6399000, 319200, 6399200] });
  });

  it("tells the model when no area is selected", () => {
    expect(userMessage("Hi", null).content[0]).toEqual({
      type: "text",
      text: "<map_context>No area is selected on the map.</map_context>",
    });
  });
});

describe("toModelMessages", () => {
  it("replays every message as stored, in order, leaving out notices", () => {
    const user = userMessage("Hi", null);
    const answer = assistantMessage([{ type: "text", text: "Hello" }]);

    expect(toModelMessages(stored(user, notice("The assistant is unavailable."), answer))).toEqual([
      { role: "user", content: user.content },
      { role: "assistant", content: answer.content },
    ]);
  });
});

describe("toEntries", () => {
  it("shows the user's words, the assistant's text and notices, in order", () => {
    const messages = stored(
      userMessage("Hi", null),
      assistantMessage([
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Hello." },
        { type: "text", text: "How can I help?" },
      ]),
      notice("Something happened."),
    );

    expect(toEntries(messages)).toEqual([
      { id: "m0", type: "user", text: "Hi", bounds: null, createdAt },
      { id: "m1", type: "assistant", text: "Hello.\n\nHow can I help?", createdAt },
      { id: "m2", type: "notice", text: "Something happened.", createdAt },
    ]);
  });

  it("shows nothing for an assistant message without text", () => {
    const messages = stored(assistantMessage([{ type: "thinking", thinking: "", signature: "sig" }]));

    expect(toEntries(messages)).toEqual([]);
  });
});
