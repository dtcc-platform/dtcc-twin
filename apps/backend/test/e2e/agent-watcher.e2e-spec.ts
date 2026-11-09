import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { chatSchema, chatDetailSchema } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStubEngine, descriptor } from "../helpers/stub-engine.js";
const engine = await startStubEngine();
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
vi.stubEnv("AGENT_MODEL_PROVIDER", "scripted");
vi.stubEnv("AGENT_JOB_WAIT_MS", "0");
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { truncateAllTables, query } = await import("../helpers/database.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");
const { AgentService } = await import("../../src/modules/agent/agent.service.js");
const { AgentRepository } = await import("../../src/modules/agent/agent.repository.js");
const fixture = await readFile(new URL("../fixtures/city-small.dtccpkg", import.meta.url));
const area = { west: 11.972, south: 57.688, east: 11.975, north: 57.6895 };
describe("Agent watcher", () => {
  let app: INestApplication<App>;
  let ada: Agent;
  let adaId: string;
  let service: InstanceType<typeof AgentService>;
  beforeAll(async () => {
    app = await createTestApp();
    service = app.get(AgentService);
  });
  afterAll(async () => {
    await app.close();
    await engine.close();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    await truncateAllTables();
    engine.reset();
    engine.setDatasets([descriptor("city")]);
    const user = await app.get(UsersService).create({ email: "ada@example.com", name: "Ada", password: "password" });
    adaId = user.id;
    ada = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
  });
  async function waiting() {
    const chat = chatSchema.parse((await ada.post("/api/agent/chats").expect(201)).body);
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send({ text: "How many buildings?", area }).expect(200);
    const engineId = engine.submissions.at(-1)?.jobId;
    if (!engineId) throw new Error("Missing engine job");
    return { chat, engineId };
  }
  it("delivers a finished job once with its count and does not charge another question", async () => {
    const { chat, engineId } = await waiting();
    engine.completeJob(engineId, fixture);
    await service.resumeFinished();
    await service.resumeFinished();
    const detail = chatDetailSchema.parse((await ada.get(`/api/agent/chats/${chat.id}`).expect(200)).body);
    expect(detail.waitingJobs).toBe(0);
    expect(detail.entries.filter((e) => e.type === "job_update")).toHaveLength(1);
    const messages = await query<{ content: unknown }>("select content from agent_messages where kind='job_update'");
    const blocks = z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(messages[0]?.content);
    const text = blocks[0]?.text;
    if (!text) throw new Error("Missing job-update report");
    const report = JSON.parse(text.slice("<job_update>".length, -"</job_update>".length)) as unknown;
    expect(z.object({ buildings: z.number() }).parse(report).buildings).toBe(21);
    const turns = await query<{ trigger: string; outcome: string }>(
      "select trigger,outcome from agent_turns order by created_at",
    );
    expect(turns).toEqual([
      { trigger: "message", outcome: "answered" },
      { trigger: "job_update", outcome: "answered" },
    ]);
    expect(await app.get(AgentRepository).countMessageTurnsSince(adaId, 24)).toBe(1);
  });
  it("leaves a locked chat for the next run", async () => {
    const { chat, engineId } = await waiting();
    engine.completeJob(engineId, fixture);
    await query("update agent_chats set turn_started_at=now() where id=$1", [chat.id]);
    await service.resumeFinished();
    expect(await query("select id from agent_messages where kind='job_update'")).toEqual([]);
    await query("update agent_chats set turn_started_at=null where id=$1", [chat.id]);
    await service.resumeFinished();
    expect(await query("select id from agent_messages where kind='job_update'")).toHaveLength(1);
  });
  it("delivers exactly once across concurrent runs", async () => {
    const { engineId } = await waiting();
    engine.completeJob(engineId, fixture);
    await Promise.all([service.resumeFinished(), service.resumeFinished()]);
    expect(await query("select id from agent_messages where kind='job_update'")).toHaveLength(1);
    expect(await query("select id from agent_turns where trigger='job_update'")).toHaveLength(1);
  });
  it("does not lock a chat whose job is still running", async () => {
    await waiting();
    await service.resumeFinished();
    expect(await query("select id from agent_messages where kind='job_update'")).toEqual([]);
    expect(await query("select turn_started_at from agent_chats")).toEqual([{ turn_started_at: null }]);
  });
  it("delivers a failed job with its error", async () => {
    const { engineId } = await waiting();
    engine.failJob(engineId, "ComputationError");
    await service.resumeFinished();
    const messages = await query("select content from agent_messages where kind='job_update'");
    expect(JSON.stringify(messages)).toContain("ComputationError");
    expect(JSON.stringify(messages)).not.toContain("buildings");
  });
  it("stores ended jobs before a new user message when the watcher has not run", async () => {
    const { chat, engineId } = await waiting();
    engine.completeJob(engineId, fixture);
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send({ text: "Hello", area }).expect(200);
    const messages = await query<{ kind: string }>("select kind from agent_messages where chat_id=$1 order by seq", [
      chat.id,
    ]);
    const update = messages.findIndex((m) => m.kind === "job_update");
    expect(update).toBeGreaterThan(0);
    expect(messages[update + 1]?.kind).toBe("user");
    expect(await query("select id from agent_turns where trigger='message'")).toHaveLength(2);
    expect(await query("select id from agent_turns where trigger='job_update'")).toHaveLength(0);
  });
  it("leaves the jobs of an inactive user waiting and runs no turn for them", async () => {
    const { chat, engineId } = await waiting();
    engine.completeJob(engineId, fixture);
    await query("update users set status='disabled' where id=$1", [adaId]);
    await service.resumeFinished();
    expect(await query("select id from agent_messages where kind='job_update'")).toEqual([]);
    expect(await query("select id from agent_turns where trigger='job_update'")).toEqual([]);
    expect(await query("select reported from agent_chat_jobs where chat_id=$1", [chat.id])).toEqual([
      { reported: false },
    ]);
  });
});
