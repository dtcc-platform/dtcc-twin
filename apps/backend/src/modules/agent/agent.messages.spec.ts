import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assistantMessage,
  closeInterrupted,
  jobUpdate,
  notice,
  toEntries,
  toModelMessages,
  toolResults,
  userMessage,
} from "./agent.messages.js";
import type { NewAgentMessage } from "./agent.repository.js";
const stored = (m: NewAgentMessage, seq: number) => ({
  ...m,
  seq,
  id: randomUUID(),
  createdAt: "2026-11-07T12:00:00Z",
});
describe("agent messages", () => {
  it("puts app map context before the user's unmodified words", () => {
    const m = userMessage("Question", null, null);
    expect(m.content).toEqual([expect.objectContaining({ type: "text" }), { type: "text", text: "Question" }]);
    expect(JSON.stringify(m.content)).toContain("<map_context>");
    expect(m.data).toEqual({ text: "Question", area: null, bounds: null });
  });
  it("replays thinking, tools and job updates unchanged and omits notices", () => {
    const messages = [
      assistantMessage([{ type: "thinking", thinking: "preserve", signature: "signed" }]),
      jobUpdate([{ job_id: randomUUID(), dataset: "city", state: "completed", buildings: 21 }]),
      notice("Hidden from model"),
    ].map(stored);
    const replay = toModelMessages(messages);
    expect(replay).toEqual([
      { role: "assistant", content: messages[0]?.content },
      { role: "user", content: messages[1]?.content },
    ]);
  });
  it("shows a job card while hiding protocol blocks", () => {
    const jobId = randomUUID();
    const entries = toEntries([
      stored(assistantMessage([{ type: "tool_use", id: "tool1", name: "run_city", input: {} }]), 1),
      stored(
        toolResults([
          {
            block: { type: "tool_result", tool_use_id: "tool1", content: "{}" },
            call: { toolUseId: "tool1", tool: "run_city", dataset: "city", jobId },
            reportedJobId: null,
          },
        ]),
        2,
      ),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "job", jobId, dataset: "city" });
  });
  it("states the area in km² to two decimals", () => {
    const m = userMessage("Question", null, [319370, 6397763, 319996, 6398458]);
    expect(JSON.stringify(m.content)).toContain("0.44 km²");
  });
  it("closes every tool call of an interrupted turn and says so", () => {
    const history = [
      userMessage("Count", null, null),
      assistantMessage([
        { type: "thinking", thinking: "kept", signature: "signed" },
        { type: "tool_use", id: "tool1", name: "run_city", input: {} },
        { type: "tool_use", id: "tool2", name: "get_job", input: { job_id: "x" } },
      ]),
      notice("Shown to the user only"),
    ].map(stored);
    const closing = closeInterrupted(history);
    expect(closing.map((m) => m.kind)).toEqual(["tool_results", "notice"]);
    expect(closing[0]?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool1",
        content: "The previous turn was interrupted before this tool finished.",
        is_error: true,
      },
      {
        type: "tool_result",
        tool_use_id: "tool2",
        content: "The previous turn was interrupted before this tool finished.",
        is_error: true,
      },
    ]);
  });
  it("leaves a complete history alone", () => {
    const use = { type: "tool_use" as const, id: "tool1", name: "run_city", input: {} };
    const answered = [
      userMessage("Count", null, null),
      assistantMessage([use]),
      toolResults([
        {
          block: { type: "tool_result", tool_use_id: "tool1", content: "{}" },
          call: { toolUseId: "tool1", tool: "run_city", dataset: "city", jobId: null },
          reportedJobId: null,
        },
      ]),
    ].map(stored);
    expect(closeInterrupted(answered)).toEqual([]);
    expect(
      closeInterrupted(
        [userMessage("Hi", null, null), assistantMessage([{ type: "text", text: "Hello" }])].map(stored),
      ),
    ).toEqual([]);
    expect(closeInterrupted([])).toEqual([]);
  });
});
