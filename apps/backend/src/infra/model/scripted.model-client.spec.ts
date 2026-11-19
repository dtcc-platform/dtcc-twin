import { describe, expect, it } from "vitest";
import { ScriptedModelClient } from "./scripted.model-client.js";
import { ModelUnavailableError, type ModelReply, type ModelRequest } from "./model.client.js";
const request: ModelRequest = { system: [], tools: [], messages: [{ role: "user", content: "Hello" }] };
const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
describe("scripted model", () => {
  it("returns script steps in order and streams their text", async () => {
    const first: ModelReply = { content: [{ type: "text", text: "First answer" }], stopReason: "end_turn", usage };
    const second: ModelReply = { content: [{ type: "text", text: "Second answer" }], stopReason: "end_turn", usage };
    const client = new ScriptedModelClient([() => first, () => second]);
    let text = "";
    const opts = {
      signal: new AbortController().signal,
      onText: (delta: string) => {
        text += delta;
      },
    };
    expect(await client.reply(request, opts)).toEqual(first);
    expect(text).toBe("First answer");
    expect(await client.reply(request, opts)).toEqual(second);
  });
  it("rejects an aborted request", async () => {
    await expect(
      new ScriptedModelClient().reply(request, { signal: AbortSignal.abort(), onText: () => undefined }),
    ).rejects.toThrow();
  });
});
it("explains a background report as an answer instead of exposing its JSON", async () => {
  let answer = "";
  await new ScriptedModelClient().reply(
    {
      system: [],
      tools: [],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: '<job_update>{"job_id":"job","dataset":"city","state":"completed","buildings":21}</job_update>',
            },
          ],
        },
      ],
    },
    {
      signal: new AbortController().signal,
      onText: (delta) => {
        answer += delta;
      },
    },
  );
  expect(answer).toBe("There are 21 buildings in this area.");
});
it("rejects a history with a tool call that has no result, as the providers do", async () => {
  const client = new ScriptedModelClient([
    () => ({ content: [{ type: "text", text: "Never" }], stopReason: "end_turn", usage }),
  ]);
  await expect(
    client.reply(
      {
        system: [],
        tools: [],
        messages: [
          { role: "user", content: "Count" },
          { role: "assistant", content: [{ type: "tool_use", id: "tool1", name: "run_city", input: {} }] },
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      },
      { signal: new AbortController().signal, onText: () => undefined },
    ),
  ).rejects.toBeInstanceOf(ModelUnavailableError);
});
