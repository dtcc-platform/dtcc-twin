import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentRepository } from "../../src/modules/agent/agent.repository.js";
import { UsersService } from "../../src/modules/users/users.service.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { query, truncateAllTables } from "../helpers/database.js";

describe("Agent repository", () => {
  let app: INestApplication;
  let repo: AgentRepository;
  let ada: string;
  let grace: string;
  beforeAll(async () => {
    app = await createTestApp({ providers: [AgentRepository] });
    repo = app.get(AgentRepository);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await truncateAllTables();
    const users = app.get(UsersService);
    ada = (await users.create({ email: "ada@example.com", name: "Ada", password: "password" })).id;
    grace = (await users.create({ email: "grace@example.com", name: "Grace", password: "password" })).id;
  });
  it("filters every chat operation by owner", async () => {
    const chat = await repo.createChat(ada, "First");
    expect(await repo.findChat(grace, chat.id)).toBeNull();
    expect(await repo.renameChat(grace, chat.id, { title: "Taken" })).toBeNull();
    expect(await repo.deleteChat(grace, chat.id)).toBe(false);
    expect(await repo.claimTurn(grace, chat.id)).toBe("missing");
    expect((await repo.listChats(grace, 20, 0)).items).toEqual([]);
    expect(await repo.renameChat(ada, chat.id, {})).toMatchObject(chat);
    expect(await repo.renameChat(ada, chat.id, { title: "Renamed" })).toMatchObject({ title: "Renamed" });
  });
  it("allows exactly one concurrent claim, expiry after ten minutes and release", async () => {
    const chat = await repo.createChat(ada, "Lock");
    expect((await Promise.all([repo.claimTurn(ada, chat.id), repo.claimTurn(ada, chat.id)])).sort()).toEqual([
      "busy",
      "claimed",
    ]);
    await query("update agent_chats set turn_started_at = now() - interval '11 minutes' where id = $1", [chat.id]);
    expect(await repo.claimTurn(ada, chat.id)).toBe("claimed");
    await repo.releaseTurn(chat.id);
    expect(await repo.claimTurn(ada, chat.id)).toBe("claimed");
  });
  it("preserves content and serializes concurrent message appends", async () => {
    const chat = await repo.createChat(ada, "History");
    const content = [
      { type: "thinking", thinking: "kept", signature: "signed" },
      { type: "text", text: "Hello" },
    ];
    await Promise.all([
      repo.appendMessages(chat.id, [{ kind: "assistant", content, data: null }]),
      repo.appendMessages(chat.id, [{ kind: "notice", content: null, data: { text: "Notice" } }]),
    ]);
    const messages = await repo.listMessages(chat.id);
    expect(messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(messages.find((m) => m.kind === "assistant")?.content).toEqual(content);
  });
  async function link(
    userId: string,
    dataset = "city",
    parameters: Record<string, unknown> = { bounds: [1, 2, 3, 4] },
  ) {
    const chat = await repo.createChat(userId, "Job");
    const rows = await query<{ id: string }>(
      "insert into jobs (user_id, dataset, parameters, engine_job_id) values ($1, $2, $3, $4) returning id",
      [userId, dataset, JSON.stringify(parameters), randomUUID()],
    );
    const jobId = rows[0]?.id;
    if (!jobId) throw new Error("missing job");
    await repo.linkJob(chat.id, jobId, dataset, parameters);
    return { chat, jobId };
  }
  it("marks jobs reported atomically with their message", async () => {
    const { chat, jobId } = await link(ada);
    expect(await repo.findChatsWaiting()).toEqual([{ id: chat.id, userId: ada }]);
    expect(await repo.listUnreportedJobIds(chat.id)).toEqual([jobId]);
    await repo.appendMessages(chat.id, [{ kind: "job_update", content: [], data: { jobId } }], [jobId]);
    expect(await repo.findChatsWaiting()).toEqual([]);
  });
  it("reuses only recent jobs for the same owner, dataset and deep-equal parameters", async () => {
    const params = { bounds: [1, 2, 3, 4], mode: "city" };
    await link(grace, "city", params);
    expect(await repo.findReusableJob(ada, "city", params)).toBeNull();
    const { jobId } = await link(ada, "city", params);
    expect(await repo.findReusableJob(ada, "city", { mode: "city", bounds: [1, 2, 3, 4] })).toBe(jobId);
    expect(await repo.findReusableJob(ada, "other", params)).toBeNull();
    expect(await repo.findReusableJob(ada, "city", { bounds: [2, 3, 4, 5] })).toBeNull();
    await query("update agent_chat_jobs set created_at = now() - interval '25 hours'");
    expect(await repo.findReusableJob(ada, "city", params)).toBeNull();
  });
  it("counts only message turns and retains turns when a chat is deleted", async () => {
    const chat = await repo.createChat(ada, "Turns");
    const base = {
      chatId: chat.id,
      userId: ada,
      outcome: "answered" as const,
      provider: "scripted",
      model: "scripted",
      promptVersion: "v1",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: "0",
      modelCalls: 1,
      jobIds: [],
      durationMs: 1,
      errorCode: null,
    };
    await repo.insertTurn({ ...base, trigger: "message" });
    await repo.insertTurn({ ...base, trigger: "job_update" });
    expect(await repo.countMessageTurnsSince(ada, 24)).toBe(1);
    expect(await repo.countMessageTurnsSince(grace, 24)).toBe(0);
    expect(await repo.deleteChat(ada, chat.id)).toBe(true);
    const turns = await query<{ chat_id: string | null }>("select chat_id from agent_turns");
    expect(turns).toEqual([{ chat_id: null }, { chat_id: null }]);
  });
  it("admits only one concurrent message at the daily boundary and counts running turns", async () => {
    const a = await repo.createChat(ada, "One");
    const b = await repo.createChat(ada, "Two");
    const metadata = { provider: "scripted", model: "scripted", promptVersion: "v1" };
    const results = await Promise.all([
      repo.reserveMessageTurn(ada, a.id, 1, metadata),
      repo.reserveMessageTurn(ada, b.id, 1, metadata),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["admitted", "limited"]);
    expect(await repo.countMessageTurnsSince(ada, 24)).toBe(1);
    const turns = await query<{ outcome: string }>("select outcome from agent_turns");
    expect(turns).toEqual([{ outcome: "running" }]);
  });
  it("does not count failed admissions with no model call", async () => {
    const chat = await repo.createChat(ada, "Interrupted");
    const reserved = await repo.reserveMessageTurn(ada, chat.id, 1, {
      provider: "scripted",
      model: "scripted",
      promptVersion: "v1",
    });
    if (reserved.status !== "admitted") throw new Error("Missing reservation");
    await repo.failTurn(reserved.turnId, ada, "client_disconnected");
    await repo.releaseTurn(chat.id);
    expect(await repo.countMessageTurnsSince(ada, 24)).toBe(0);
    expect(
      await repo.reserveMessageTurn(ada, chat.id, 1, { provider: "scripted", model: "scripted", promptVersion: "v1" }),
    ).toMatchObject({ status: "admitted" });
  });
  const metadata = { provider: "scripted", model: "scripted", promptVersion: "v1" };
  function runningTurn(chatId: string) {
    return repo.insertTurn({
      ...metadata,
      chatId,
      userId: ada,
      trigger: "message",
      outcome: "running",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
      modelCalls: 0,
      jobIds: [],
      durationMs: 0,
      errorCode: null,
    });
  }
  it("reports a busy or missing chat without storing a turn", async () => {
    const chat = await repo.createChat(ada, "Busy");
    expect(await repo.claimTurn(ada, chat.id)).toBe("claimed");
    expect(await repo.reserveMessageTurn(ada, chat.id, 100, metadata)).toEqual({ status: "busy" });
    expect(await repo.reserveMessageTurn(grace, chat.id, 100, metadata)).toEqual({ status: "missing" });
    expect(await query("select id from agent_turns")).toEqual([]);
  });
  it("fails the running turns of a chat whose expired lock is taken", async () => {
    // A process that died mid-turn leaves its turn running and the chat locked until the lock expires.
    const crashed = await repo.createChat(ada, "Crashed");
    const asked = await repo.createChat(ada, "Crashed before a question");
    const free = await repo.createChat(ada, "Free");
    const stale = await runningTurn(crashed.id);
    const staleAsked = await runningTurn(asked.id);
    const unlocked = await runningTurn(free.id);
    await query("update agent_chats set turn_started_at = now() - interval '11 minutes' where id = any($1)", [
      [crashed.id, asked.id],
    ]);
    expect(await repo.claimTurn(ada, crashed.id)).toBe("claimed");
    expect(await repo.claimTurn(ada, free.id)).toBe("claimed");
    const reserved = await repo.reserveMessageTurn(ada, asked.id, 100, metadata);
    if (reserved.status !== "admitted") throw new Error("Missing reservation");
    const outcomes = await query<{ id: string; outcome: string; error_code: string | null }>(
      "select id, outcome, error_code from agent_turns",
    );
    const byId = Object.fromEntries(outcomes.map((row) => [row.id, [row.outcome, row.error_code]]));
    expect(byId).toEqual({
      [stale]: ["failed", "interrupted"],
      [staleAsked]: ["failed", "interrupted"],
      [unlocked]: ["running", null],
      [reserved.turnId]: ["running", null],
    });
  });
});
