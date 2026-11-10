import { describe, expect, it } from "vitest";
import { agentEventSchema, askBodySchema, chatEntrySchema, chatSchema } from "./agent.js";

const id = "019a5184-7bc0-7000-8000-000000000001";
const createdAt = "2026-11-07T12:00:00Z";

describe("agent contracts", () => {
  it("accepts a question without an area and trims its text", () => {
    expect(askBodySchema.parse({ text: "  Hello  ", area: null })).toEqual({ text: "Hello", area: null });
  });
  it.each([
    { text: "Hello" },
    { text: "", area: null },
    { text: " ", area: null },
    { text: "x".repeat(4001), area: null },
    { text: "Hello", area: null, extra: true },
  ])("rejects invalid question %j", (body) => {
    expect(askBodySchema.safeParse(body).success).toBe(false);
  });
  it.each([
    { type: "status", message: "Working" },
    { type: "text", delta: "Hello" },
    { type: "job", jobId: id, dataset: "city" },
    { type: "done", turnId: id },
    { type: "error", code: "AGENT_UNAVAILABLE", message: "Unavailable" },
  ])("parses event %j", (event) => {
    expect(agentEventSchema.parse(event)).toEqual(event);
  });
  it("rejects a text event without a delta", () => {
    expect(agentEventSchema.safeParse({ type: "text" }).success).toBe(false);
  });
  it("strips private fields from a chat", () => {
    expect(chatSchema.parse({ id, title: "Chat", createdAt, updatedAt: createdAt, userId: id })).toEqual({
      id,
      title: "Chat",
      createdAt,
      updatedAt: createdAt,
    });
  });
  it("requires a job update's state", () => {
    expect(chatEntrySchema.safeParse({ type: "job_update", id, createdAt, jobId: id, dataset: "city" }).success).toBe(
      false,
    );
  });
});
