import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ModelUnavailableError, type ModelRequest } from "./model.client.js";
import { scriptedReply } from "./scripted-model.js";

function said(text: string, mapContext = "<map_context>No area is selected on the map.</map_context>"): ModelRequest {
  const message: Anthropic.MessageParam = {
    role: "user",
    content: [
      { type: "text", text: mapContext },
      { type: "text", text },
    ],
  };
  return { system: "You are a test.", tools: [], messages: [message] };
}

function textOf(content: Anthropic.ContentBlockParam[]): string {
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("scriptedReply", () => {
  it("answers the user's latest words, ending the turn", () => {
    const reply = scriptedReply(said("Hello there"));

    expect(reply.stopReason).toBe("end_turn");
    expect(textOf(reply.content)).toContain("Hello there");
  });

  it("says whether the map context shows a selected area", () => {
    const withArea = said(
      "Hi",
      "<map_context>Selected area: EPSG:3006 bounds [0, 0, 200, 200], 0.04 km².</map_context>",
    );

    expect(textOf(scriptedReply(withArea).content)).toContain("0.04 km²");
    expect(textOf(scriptedReply(said("Hi")).content)).toContain("No area is selected");
  });

  it("refuses, with no content, when told to", () => {
    expect(scriptedReply(said("Please [refuse]"))).toMatchObject({ stopReason: "refusal", content: [] });
  });

  it("fails, as an unreachable model does, when told to", () => {
    expect(() => scriptedReply(said("Please [fail]"))).toThrow(ModelUnavailableError);
  });

  it("reports tokens for the request and the reply", () => {
    const { usage } = scriptedReply(said("Hello"));

    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });
});

describe("scriptedReply with tools", () => {
  const tools: Anthropic.Tool[] = [
    { name: "run_trees", description: "Trees. Tree locations.", input_schema: { type: "object" } },
    { name: "run_air_quality", description: "Air quality. Pollutant levels.", input_schema: { type: "object" } },
    { name: "get_job", description: "A job's state.", input_schema: { type: "object" } },
  ];

  function toolUse(id: string, name: string): Anthropic.ToolUseBlockParam {
    return { type: "tool_use", id, name, input: {} };
  }

  function toolResult(id: string, content: unknown, isError = false): Anthropic.ToolResultBlockParam {
    return { type: "tool_result", tool_use_id: id, content: JSON.stringify(content), is_error: isError };
  }

  it("calls the tool of every Dataset the user names, by name or title", () => {
    const reply = scriptedReply({ ...said("How many trees are there? And the air quality?"), tools });

    expect(reply.stopReason).toBe("tool_use");
    const calls = reply.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));
    expect(calls.map((call) => [call.name, call.input])).toEqual([
      ["run_trees", {}],
      ["run_air_quality", {}],
    ]);
  });

  it("answers every tool result: still running, finished with what its manifest says, or an error", () => {
    const request = said("Trees and air quality");
    request.tools = tools;
    request.messages.push(
      {
        role: "assistant",
        content: [toolUse("a", "run_trees"), toolUse("b", "run_air_quality"), toolUse("c", "run_trees")],
      },
      {
        role: "user",
        content: [
          toolResult("a", { job_id: "j1", dataset: "trees", state: "running" }),
          toolResult("b", {
            job_id: "j2",
            dataset: "air_quality",
            state: "completed",
            result: { presentation: { headline: "Air quality index" }, summary: { no2: 12 } },
          }),
          toolResult("c", "No area is selected on the map.", true),
        ],
      },
    );

    const reply = scriptedReply(request);

    expect(reply.stopReason).toBe("end_turn");
    const answer = textOf(reply.content);
    expect(answer).toContain("trees is running");
    expect(answer).toContain("Air quality index");
    expect(answer).toContain("no2: 12");
    expect(answer).toContain("No area is selected on the map.");
  });

  it("looks up the latest job when the user asks whether it is done", () => {
    const request = said("Trees");
    request.tools = tools;
    request.messages.push(
      { role: "assistant", content: [toolUse("a", "run_trees")] },
      { role: "user", content: [toolResult("a", { job_id: "j1", dataset: "trees", state: "running" })] },
      { role: "assistant", content: [{ type: "text", text: "It is running." }] },
      { role: "user", content: [{ type: "text", text: "Is it done yet?" }] },
    );

    const reply = scriptedReply(request);

    expect(reply.content).toContainEqual(
      expect.objectContaining({ type: "tool_use", name: "get_job", input: { job_id: "j1" } }),
    );
  });
});
