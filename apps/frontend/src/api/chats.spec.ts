import type { Chat } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { chatPollInterval } from "./chats.ts";

function chat(changes: Partial<Chat> = {}): Chat {
  return {
    id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
    title: "Trees",
    createdAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    entries: [],
    answering: false,
    jobs: [],
    waitingJobs: 0,
    ...changes,
  };
}

describe("chatPollInterval", () => {
  it("polls while a turn runs, or a job the chat waits on hasn't been reported", () => {
    expect(chatPollInterval(chat({ answering: true }))).toBeGreaterThan(0);
    expect(chatPollInterval(chat({ waitingJobs: 1 }))).toBeGreaterThan(0);
  });

  it("stops once nothing will change the chat without the user", () => {
    expect(chatPollInterval(chat())).toBe(false);
    expect(chatPollInterval(undefined)).toBe(false);
  });
});
