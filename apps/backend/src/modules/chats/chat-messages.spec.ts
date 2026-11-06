import { describe, expect, it } from "vitest";
import {
  assistantMessage,
  jobUpdate,
  notice,
  toEntries,
  toModelMessages,
  toolResults,
  userMessage,
  type ChatMessage,
  type NewChatMessage,
} from "./chat-messages.js";

const createdAt = "2026-11-06T10:00:00.000Z";

// Stored messages as the repository answers them: the new message plus its id, position and time.
function stored(...messages: NewChatMessage[]): ChatMessage[] {
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

describe("toolResults", () => {
  const started = {
    toolUseId: "a",
    tool: "run_trees",
    dataset: "trees",
    jobId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
  };
  const refused = { toolUseId: "b", tool: "run_trees", dataset: "trees", jobId: null };
  const results = toolResults([
    { block: { type: "tool_result", tool_use_id: "a", content: '{"state":"running"}' }, call: started },
    { block: { type: "tool_result", tool_use_id: "b", content: "No area", is_error: true }, call: refused },
  ]);

  it("sends every result to the model in one user message", () => {
    expect(toModelMessages(stored(results))).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: '{"state":"running"}' },
          { type: "tool_result", tool_use_id: "b", content: "No area", is_error: true },
        ],
      },
    ]);
  });

  it("shows a card for each job a call started", () => {
    expect(toEntries(stored(results))).toEqual([
      { id: "m0:0", type: "job", jobId: started.jobId, dataset: "trees", createdAt },
    ]);
  });
});

describe("jobUpdate", () => {
  const jobId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c";
  const update = jobUpdate([{ job_id: jobId, dataset: "trees", state: "completed", result: { identity: {} } }]);

  it("tells the model how each job ended in a block of its own, from the app rather than the user", () => {
    expect(toModelMessages(stored(update))).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<job_update>\n{"job_id":"${jobId}","dataset":"trees","state":"completed","result":{"identity":{}}}\n</job_update>`,
          },
        ],
      },
    ]);
  });

  it("shows each job's end in the transcript", () => {
    expect(toEntries(stored(update))).toEqual([
      { id: "m0:0", type: "job_update", jobId, dataset: "trees", state: "completed", createdAt },
    ]);
  });
});
