import { describe, expect, it } from "vitest";
import { chatMessageBodySchema, chatSchema } from "./chats.js";

const bounds = [319891, 6399790, 320091, 6399990];

describe("chatMessageBodySchema", () => {
  it("trims the text and keeps the bounds", () => {
    expect(chatMessageBodySchema.parse({ text: "  How many trees?  ", bounds })).toEqual({
      text: "How many trees?",
      bounds,
    });
  });

  it("takes null bounds when no area is drawn", () => {
    expect(chatMessageBodySchema.parse({ text: "Hello", bounds: null }).bounds).toBeNull();
  });

  it("refuses an empty or overlong text", () => {
    expect(chatMessageBodySchema.safeParse({ text: "   ", bounds: null }).success).toBe(false);
    expect(chatMessageBodySchema.safeParse({ text: "a".repeat(4001), bounds: null }).success).toBe(false);
  });

  it("refuses bounds whose maximum is not above their minimum, naming the side", () => {
    const result = chatMessageBodySchema.safeParse({ text: "Hi", bounds: [10, 10, 5, 20] });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["bounds", 2]]);
  });

  it("refuses bounds that are not four numbers, and unknown keys", () => {
    expect(chatMessageBodySchema.safeParse({ text: "Hi", bounds: [1, 2, 3] }).success).toBe(false);
    expect(chatMessageBodySchema.safeParse({ text: "Hi", bounds: null, model: "opus" }).success).toBe(false);
  });
});

describe("chatSchema", () => {
  it("strips what the API does not declare, such as the chat's owner", () => {
    const chat = {
      id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
      title: "Trees",
      createdAt: "2026-11-06T10:00:00.000Z",
      updatedAt: "2026-11-06T10:00:05.000Z",
      entries: [{ id: "a", type: "assistant", text: "Hi", createdAt: "2026-11-06T10:00:05.000Z" }],
      answering: false,
    };

    expect(chatSchema.parse({ ...chat, userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b" })).toEqual(chat);
  });
});
