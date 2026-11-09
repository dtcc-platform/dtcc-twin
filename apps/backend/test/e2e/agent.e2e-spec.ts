import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { agentEventSchema, chatSchema, chatDetailSchema, chatPageSchema, errorResponseSchema } from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStubEngine, descriptor } from "../helpers/stub-engine.js";
const engine = await startStubEngine();
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
vi.stubEnv("AGENT_MODEL_PROVIDER", "scripted");
vi.stubEnv("AGENT_JOB_WAIT_MS", "200");
vi.stubEnv("AGENT_RESUME_INTERVAL_SECONDS", "0");
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { truncateAllTables, query } = await import("../helpers/database.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");
const { AgentRepository } = await import("../../src/modules/agent/agent.repository.js");
const { AgentTurnRunner } = await import("../../src/modules/agent/agent.turns.js");
const area = { west: 11.972, south: 57.688, east: 11.975, north: 57.6895 };
const body = { text: "How many buildings are there here?", area };
const fixture = await readFile(new URL("../fixtures/city-small.dtccpkg", import.meta.url));
function events(text: string) {
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => agentEventSchema.parse(JSON.parse(frame.slice(6))));
}

describe("Agent routes", () => {
  let app: INestApplication<App>;
  let ada: Agent;
  let grace: Agent;
  let adaId: string;
  beforeAll(async () => {
    app = await createTestApp();
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
    const users = app.get(UsersService);
    adaId = (await users.create({ email: "ada@example.com", name: "Ada", password: "password" })).id;
    const graceId = (await users.create({ email: "grace@example.com", name: "Grace", password: "password" })).id;
    ada = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: adaId }));
    grace = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: graceId }));
  });
  async function create() {
    return chatSchema.parse((await ada.post("/api/agent/chats").expect(201)).body);
  }
  it("streams a job result and stores accounting and the last area", async () => {
    const chat = await create();
    const timer = setInterval(() => {
      const id = engine.submissions.at(-1)?.jobId;
      if (id) engine.completeJob(id, fixture);
    }, 10);
    let response;
    try {
      response = await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(200);
    } finally {
      clearInterval(timer);
    }
    const streamed = events(response.text);
    expect(streamed.map((e) => e.type)).toEqual(expect.arrayContaining(["status", "job", "text", "done"]));
    expect(streamed.flatMap((e) => (e.type === "text" ? e.delta : [])).join("")).toContain("21");
    const detail = chatDetailSchema.parse((await ada.get(`/api/agent/chats/${chat.id}`).expect(200)).body);
    expect(detail).toMatchObject({ area, waitingJobs: 0, answering: false });
    expect(detail.jobs).toHaveLength(1);
    const turns = await query("select * from agent_turns");
    expect(turns[0]).toMatchObject({
      provider: "scripted",
      model: "scripted",
      cost_usd: "0",
      model_calls: 2,
      job_ids: [detail.jobs[0]?.id],
    });
    expect(turns[0]?.["input_tokens"]).toBeGreaterThan(0);
    expect(turns[0]?.["prompt_version"]).toMatch(/^[a-f0-9]{12}$/);
  });
  it("reports that a slow job will be posted later", async () => {
    const chat = await create();
    const response = await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(200);
    expect(
      events(response.text)
        .flatMap((e) => (e.type === "text" ? e.delta : []))
        .join(""),
    ).toContain("will be posted");
    const detail = chatDetailSchema.parse((await ada.get(`/api/agent/chats/${chat.id}`).expect(200)).body);
    expect(detail.waitingJobs).toBe(1);
  });
  it("owner-filters every id route and requires authentication on all routes", async () => {
    const chat = await create();
    const path = `/api/agent/chats/${chat.id}`;
    await grace.get(path).expect(404);
    await grace.patch(path).send({ title: "Taken" }).expect(404);
    await grace.delete(path).expect(404);
    await grace.post(`${path}/messages`).send(body).expect(404);
    expect(chat.id).toBeTruthy();
    const anonymous = request(app.getHttpServer());
    await anonymous.get("/api/agent/chats").expect(401);
    await anonymous.post("/api/agent/chats").expect(401);
    await anonymous.get(path).expect(401);
    await anonymous.patch(path).send({ title: "Taken" }).expect(401);
    await anonymous.delete(path).expect(401);
    await anonymous.post(`${path}/messages`).send(body).expect(401);
  });
  it("refuses inactive accounts and invalid inputs before storing a message", async () => {
    const chat = await create();
    for (const status of ["pending", "disabled"] as const) {
      await query("update users set status=$1 where id=$2", [status, adaId]);
      await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(403);
    }
    await query("update users set status='active' where id=$1", [adaId]);
    const over = await ada
      .post(`/api/agent/chats/${chat.id}/messages`)
      .send({ ...body, area: { west: 11.9, south: 57.6, east: 12, north: 57.7 } })
      .expect(422);
    expect(errorResponseSchema.parse(over.body).error.code).toBe("AGENT_AREA_TOO_LARGE");
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send({ text: "" }).expect(400);
    expect(await query("select * from agent_messages")).toEqual([]);
    expect(engine.submissions).toEqual([]);
  });
  it("refuses the 101st message turn but accepts area null", async () => {
    const chat = await create();
    const response = await ada
      .post(`/api/agent/chats/${chat.id}/messages`)
      .send({ ...body, area: null })
      .expect(200);
    expect(
      events(response.text)
        .flatMap((e) => (e.type === "text" ? e.delta : []))
        .join(""),
    ).toMatch(/area/i);
    expect(engine.submissions).toEqual([]);
    await query(
      "insert into agent_turns (chat_id,user_id,trigger,outcome,provider,model,prompt_version,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd,model_calls,job_ids,duration_ms) select $1,$2,'message','answered','scripted','scripted','v1',0,0,0,0,0,0,'{}',0 from generate_series(1,99)",
      [chat.id, adaId],
    );
    const limited = await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(429);
    expect(errorResponseSchema.parse(limited.body).error.code).toBe("AGENT_DAILY_LIMIT");
  });

  it("admits one stream and one 429 across different chats at 99 questions", async () => {
    const first = await create();
    const second = await create();
    await query(
      "insert into agent_turns (chat_id,user_id,trigger,outcome,provider,model,prompt_version,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd,model_calls,job_ids,duration_ms) select $1,$2,'message','answered','scripted','scripted','v1',0,0,0,0,0,0,'{}',0 from generate_series(1,99)",
      [first.id, adaId],
    );
    const responses = await Promise.all([
      ada.post(`/api/agent/chats/${first.id}/messages`).send(body),
      ada.post(`/api/agent/chats/${second.id}/messages`).send(body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(errorResponseSchema.parse(responses.find((r) => r.status === 429)?.body).error.code).toBe(
      "AGENT_DAILY_LIMIT",
    );
    expect((await query("select id from agent_turns where trigger='message'")).length).toBe(100);
  });
  it("does not charge quota or store turns for busy-chat and oversized-area rejections", async () => {
    const chat = await create();
    await query("update agent_chats set turn_started_at=now() where id=$1", [chat.id]);
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(409);
    expect(await query("select id from agent_turns")).toEqual([]);
    await query("update agent_chats set turn_started_at=null where id=$1", [chat.id]);
    await ada
      .post(`/api/agent/chats/${chat.id}/messages`)
      .send({ ...body, area: { west: 11.9, south: 57.6, east: 12, north: 57.7 } })
      .expect(422);
    expect(await query("select id from agent_turns")).toEqual([]);
  });
  it("locks one chat while allowing different chats of the same user", async () => {
    const first = await create();
    const second = await create();
    const responses = await Promise.all([
      ada.post(`/api/agent/chats/${first.id}/messages`).send(body),
      ada.post(`/api/agent/chats/${first.id}/messages`).send(body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((r) => r.status === 409);
    expect(errorResponseSchema.parse(conflict?.body).error.code).toBe("AGENT_CHAT_BUSY");
    const both = await Promise.all([
      ada.post(`/api/agent/chats/${first.id}/messages`).send({ ...body, text: "Hello" }),
      ada.post(`/api/agent/chats/${second.id}/messages`).send({ ...body, text: "Hello" }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
  });
  it("releases the lock after a client disconnect and lets its job continue", async () => {
    const chat = await create();
    await app.listen(0, "127.0.0.1");
    const abort = new AbortController();
    const response = await fetch(`${await app.getUrl()}/api/agent/chats/${chat.id}/messages`, {
      method: "POST",
      headers: { ...(await authHeader("user", { userId: adaId })), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No stream");
    let received = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += new TextDecoder().decode(chunk.value);
      if (received.includes('"type":"job"')) {
        abort.abort();
        break;
      }
    }
    await vi.waitFor(async () => {
      const records = await query("select outcome,error_code from agent_turns where chat_id=$1", [chat.id]);
      expect(records).toEqual([{ outcome: "failed", error_code: "client_disconnected" }]);
    });
    const detail = chatDetailSchema.parse((await ada.get(`/api/agent/chats/${chat.id}`).expect(200)).body);
    expect(detail).toMatchObject({ answering: false, waitingJobs: 1 });
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send({ text: "Hello", area }).expect(200);
  });
  it("renames and deletes a chat while keeping its job in Downloads", async () => {
    const chat = await create();
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(200);
    expect(
      chatSchema.parse((await ada.patch(`/api/agent/chats/${chat.id}`).send({ title: "Renamed" }).expect(200)).body)
        .title,
    ).toBe("Renamed");
    await ada.delete(`/api/agent/chats/${chat.id}`).expect(204);
    await ada.get(`/api/agent/chats/${chat.id}`).expect(404);
    expect(await query("select * from agent_messages")).toEqual([]);
    expect(await query("select * from jobs")).toHaveLength(1);
  });
  it("lists only the caller's chats, newest first", async () => {
    const first = await create();
    const second = await create();
    await grace.post("/api/agent/chats").expect(201);
    const page = chatPageSchema.parse((await ada.get("/api/agent/chats").expect(200)).body);
    expect(page.items.map((chat) => chat.id)).toEqual([second.id, first.id]);
    expect(page.total).toBe(2);
  });
  it("rejects a malformed id and an invalid rename with the path of each issue", async () => {
    const paths = (error: unknown) => errorResponseSchema.parse(error).error.errors?.map((issue) => issue.path);
    expect(paths((await ada.get("/api/agent/chats/not-an-id").expect(400)).body)).toEqual(["id"]);
    expect(paths((await ada.post("/api/agent/chats/not-an-id/messages").send(body).expect(400)).body)).toEqual(["id"]);
    const chat = await create();
    expect(paths((await ada.patch(`/api/agent/chats/${chat.id}`).send({ title: "" }).expect(400)).body)).toEqual([
      "title",
    ]);
    const unknown = await ada.patch(`/api/agent/chats/${chat.id}`).send({ owner: "grace" }).expect(400);
    expect(errorResponseSchema.parse(unknown.body).error.code).toBe("VALIDATION_FAILED");
  });
  it("closes a tool call left open by an interrupted turn before the next question", async () => {
    // A process that dies while a tool waits leaves the assistant's tool_use without a stored result.
    const chat = await create();
    await app.get(AgentRepository).appendMessages(chat.id, [
      {
        kind: "user",
        content: [{ type: "text", text: "How many buildings?" }],
        data: { text: "How many buildings?", area: null, bounds: null },
      },
      { kind: "assistant", content: [{ type: "tool_use", id: "toolu_lost", name: "run_city", input: {} }], data: null },
    ]);
    const response = await ada.post(`/api/agent/chats/${chat.id}/messages`).send({ text: "Hello", area }).expect(200);
    expect(events(response.text).at(-1)?.type).toBe("done");
    const kinds = await query<{ kind: string }>("select kind from agent_messages where chat_id=$1 order by seq", [
      chat.id,
    ]);
    expect(kinds.map((row) => row.kind)).toEqual(["user", "assistant", "tool_results", "notice", "user", "assistant"]);
    expect(await query("select outcome from agent_turns")).toEqual([{ outcome: "answered" }]);
  });
  it("ends an opened stream with an error event when the turn fails, and frees the chat", async () => {
    const chat = await create();
    const run = vi.spyOn(app.get(AgentTurnRunner), "run").mockImplementationOnce((_chat, _trigger, opts) => {
      opts.onEvent?.({ type: "status", message: "Thinking…" });
      return Promise.reject(new Error("Database connection lost"));
    });
    const response = await ada.post(`/api/agent/chats/${chat.id}/messages`).send(body).expect(200);
    run.mockRestore();
    expect(events(response.text)).toEqual([
      { type: "status", message: "Thinking…" },
      { type: "error", code: "AGENT_UNAVAILABLE", message: expect.any(String) as unknown },
    ]);
    expect(await query("select outcome, error_code from agent_turns")).toEqual([
      { outcome: "failed", error_code: "internal_error" },
    ]);
    const detail = chatDetailSchema.parse((await ada.get(`/api/agent/chats/${chat.id}`).expect(200)).body);
    expect(detail.answering).toBe(false);
  });
  it("ends the turn with an error event when its chat is deleted mid-turn", async () => {
    const chat = await create();
    const asking = ada
      .post(`/api/agent/chats/${chat.id}/messages`)
      .send(body)
      .then((response) => response);
    await vi.waitFor(
      () => {
        expect(engine.submissions).toHaveLength(1);
      },
      { interval: 5 },
    );
    await ada.delete(`/api/agent/chats/${chat.id}`).expect(204);
    const response = await asking;
    expect(response.status).toBe(200);
    expect(events(response.text).at(-1)).toMatchObject({ type: "error", code: "AGENT_UNAVAILABLE" });
    expect(await query("select outcome, chat_id from agent_turns")).toEqual([{ outcome: "failed", chat_id: null }]);
  });
  it("stores a question without NUL characters", async () => {
    const chat = await create();
    await ada.post(`/api/agent/chats/${chat.id}/messages`).send({ text: "Hello\u0000 there", area }).expect(200);
    const rows = await query<{ data: { text: string } }>("select data from agent_messages where kind='user'");
    expect(rows[0]?.data.text).toBe("Hello there");
  });
});
