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
