import type { INestApplication } from "@nestjs/common";
import { chatPageSchema, chatSchema, errorResponseSchema, type Chat, type ChatEntry } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The scripted model answers at once here; in development it waits, as a real model would.
vi.stubEnv("SCRIPTED_MODEL_DELAY_MS", "0");
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { query, truncateAllTables } = await import("../helpers/database.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");

const bounds = [319891, 6399790, 320091, 6399990];
const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";

describe("Chats (e2e)", () => {
  let app: INestApplication<App>;
  // Two logged-in users, so every route can show it never reaches the other one's chats.
  let ada: Agent;
  let adaId: string;
  let grace: Agent;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await truncateAllTables();
    ({ agent: ada, userId: adaId } = await loggedIn("ada@example.com"));
    ({ agent: grace } = await loggedIn("grace@example.com"));
  });

  async function loggedIn(email: string): Promise<{ agent: Agent; userId: string }> {
    const user = await app.get(UsersService).create({ email, name: "Owner", password: "correct horse" });
    const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
    return { agent, userId: user.id };
  }

  async function start(agent: Agent, text: string, area: number[] | null = bounds): Promise<Chat> {
    const response = await agent.post("/api/chats").send({ text, bounds: area }).expect(201);
    return chatSchema.parse(response.body);
  }

  async function send(agent: Agent, chatId: string, text: string, area: number[] | null = bounds): Promise<Chat> {
    const response = await agent.post(`/api/chats/${chatId}/messages`).send({ text, bounds: area }).expect(201);
    return chatSchema.parse(response.body);
  }

  function types(entries: ChatEntry[]): string[] {
    return entries.map((entry) => entry.type);
  }

  it("needs a logged-in user", async () => {
    const response = await request(app.getHttpServer()).get("/api/chats").expect(401);

    expect(errorResponseSchema.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  describe("POST /api/chats", () => {
    it("starts a chat with its first message, titled after it, and answers it", async () => {
      const chat = await start(ada, "Hello there");

      expect(chat).toMatchObject({ title: "Hello there", answering: false });
      expect(chat.entries).toEqual([
        expect.objectContaining({ type: "user", text: "Hello there", bounds }),
        expect.objectContaining({ type: "assistant", text: expect.stringContaining("Hello there") as string }),
      ]);
    });

    it("titles a chat after the first line of its first message, shortened", async () => {
      const chat = await start(ada, `${"a".repeat(120)}\nsecond line`);

      expect(chat.title).toBe(`${"a".repeat(79)}…`);
    });

    it("refuses pending and disabled accounts with FORBIDDEN, starting no chat", async () => {
      const users = app.get(UsersService);
      const pending = await users.register({ email: "kat@example.com", name: "Katherine", password: "correct horse" });
      const disabled = await users.create({ email: "charles@example.com", name: "Charles", password: "correct horse" });
      await users.setStatus(disabled.id, "disabled");

      for (const userId of [pending.id, disabled.id]) {
        const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId }));
        const response = await agent.post("/api/chats").send({ text: "Hi", bounds: null }).expect(403);
        expect(errorResponseSchema.parse(response.body).error.code).toBe("FORBIDDEN");
      }
      expect(await query("select id from chats")).toEqual([]);
    });

    it("rejects an empty text, bounds out of order and unknown keys", async () => {
      const response = await ada
        .post("/api/chats")
        .send({ text: " ", bounds: [10, 10, 5, 20], model: "opus" })
        .expect(400);

      const error = errorResponseSchema.parse(response.body).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.errors?.map((issue) => issue.path)).toEqual(expect.arrayContaining(["text", "bounds.2"]));
      expect(await query("select id from chats")).toEqual([]);
    });
  });

  describe("POST /api/chats/:id/messages", () => {
    it("adds the message and the assistant's answer to the conversation", async () => {
      const chat = await start(ada, "First");

      const continued = await send(ada, chat.id, "Second", null);

      expect(types(continued.entries)).toEqual(["user", "assistant", "user", "assistant"]);
      expect(continued.entries[2]).toMatchObject({ type: "user", text: "Second", bounds: null });
      expect(continued.entries[3]).toMatchObject({ text: expect.stringContaining("Second") as string });
    });

    it("answers CONFLICT while a turn is running in the chat, keeping nothing of the message", async () => {
      const chat = await start(ada, "First");
      await query("update chats set turn_started_at = now() where id = $1", [chat.id]);

      const response = await ada.post(`/api/chats/${chat.id}/messages`).send({ text: "Again", bounds }).expect(409);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("CONFLICT");
      const stored = chatSchema.parse((await ada.get(`/api/chats/${chat.id}`).expect(200)).body);
      expect(stored).toMatchObject({ answering: true });
      expect(types(stored.entries)).toEqual(["user", "assistant"]);
    });

    // A turn holds the chat for minutes at most; one that started long ago died with its process.
    it("takes the chat over from a turn that started more than ten minutes ago", async () => {
      const chat = await start(ada, "First");
      await query("update chats set turn_started_at = now() - interval '11 minutes' where id = $1", [chat.id]);

      const continued = await send(ada, chat.id, "Second");

      expect(continued.answering).toBe(false);
      expect(types(continued.entries)).toEqual(["user", "assistant", "user", "assistant"]);
    });

    it("keeps the message and shows a notice when the model fails", async () => {
      const chat = await start(ada, "First");

      const continued = await send(ada, chat.id, "Please [fail]");

      expect(types(continued.entries)).toEqual(["user", "assistant", "user", "notice"]);
      expect(continued.answering).toBe(false);
    });

    it("shows a notice and keeps no answer when the model refuses", async () => {
      const chat = await start(ada, "Please [refuse]");

      expect(types(chat.entries)).toEqual(["user", "notice"]);
      const continued = await send(ada, chat.id, "Something else");
      expect(types(continued.entries)).toEqual(["user", "notice", "user", "assistant"]);
    });

    it("answers NOT_FOUND for another user's chat, as for one that does not exist", async () => {
      const graces = await start(grace, "Mine");

      const other = await ada.post(`/api/chats/${graces.id}/messages`).send({ text: "Hi", bounds }).expect(404);
      const missing = await ada.post(`/api/chats/${missingId}/messages`).send({ text: "Hi", bounds }).expect(404);

      expect(errorResponseSchema.parse(other.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/chats", () => {
    it("lists only the user's own chats, most recently active first, paged with limit and offset", async () => {
      const first = await start(ada, "First");
      await start(grace, "Grace's");
      const second = await start(ada, "Second");
      await send(ada, first.id, "Back to the first");

      const all = chatPageSchema.parse((await ada.get("/api/chats").expect(200)).body);
      expect(all).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(all.items.map((chat) => chat.id)).toEqual([first.id, second.id]);
      expect(all.items[0]).not.toHaveProperty("entries");

      const page = chatPageSchema.parse((await ada.get("/api/chats?limit=1&offset=1").expect(200)).body);
      expect(page.items.map((chat) => chat.id)).toEqual([second.id]);
    });
  });

  describe("GET /api/chats/:id", () => {
    it("answers the chat with its whole conversation", async () => {
      const chat = await start(ada, "First");

      const stored = chatSchema.parse((await ada.get(`/api/chats/${chat.id}`).expect(200)).body);

      expect(stored).toEqual(chat);
    });

    it("answers NOT_FOUND for another user's chat, as for one that does not exist", async () => {
      const graces = await start(grace, "Mine");

      const other = await ada.get(`/api/chats/${graces.id}`).expect(404);
      const missing = await ada.get(`/api/chats/${missingId}`).expect(404);

      expect(errorResponseSchema.parse(other.body).error.code).toBe("NOT_FOUND");
      expect(errorResponseSchema.parse(missing.body).error.code).toBe("NOT_FOUND");
    });

    it("rejects an id that is not a UUID", async () => {
      const response = await ada.get("/api/chats/not-a-uuid").expect(400);

      expect(errorResponseSchema.parse(response.body).error.errors?.map((issue) => issue.path)).toEqual(["id"]);
    });
  });

  describe("DELETE /api/chats/:id", () => {
    it("deletes the chat and its conversation", async () => {
      const chat = await start(ada, "First");

      await ada.delete(`/api/chats/${chat.id}`).expect(204);

      await ada.get(`/api/chats/${chat.id}`).expect(404);
      expect(await query("select id from chat_messages")).toEqual([]);
    });

    it("answers NOT_FOUND for another user's chat, leaving it", async () => {
      const graces = await start(grace, "Mine");

      const response = await ada.delete(`/api/chats/${graces.id}`).expect(404);

      expect(errorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
      expect(chatSchema.parse((await grace.get(`/api/chats/${graces.id}`).expect(200)).body).id).toBe(graces.id);
    });
  });

  describe("turn records", () => {
    it("records every turn with its outcome and tokens, and keeps them when the chat is deleted", async () => {
      const chat = await start(ada, "First");
      await send(ada, chat.id, "Now [fail]");
      await ada.delete(`/api/chats/${chat.id}`).expect(204);

      const turns = await query<{ user_id: string; chat_id: string | null; outcome: string; input_tokens: number }>(
        "select user_id, chat_id, outcome, input_tokens from chat_turns order by created_at",
      );
      expect(turns).toEqual([
        { user_id: adaId, chat_id: null, outcome: "answered", input_tokens: expect.any(Number) as number },
        { user_id: adaId, chat_id: null, outcome: "failed", input_tokens: 0 },
      ]);
      expect(turns[0]?.input_tokens).toBeGreaterThan(0);
    });
  });
});
