import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  chatPageSchema,
  chatSchema,
  errorResponseSchema,
  jobPageSchema,
  type Chat,
  type ChatEntry,
} from "@repo/contracts";
import request, { type Agent } from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dtccPackage, manifestOf } from "../helpers/packages.js";
import { descriptor, startStubEngine } from "../helpers/stub-engine.js";

// ConfigModule reads the environment when app.module.ts is imported, so the stub must be listening before that.
const engine = await startStubEngine();
const packageDir = await mkdtemp(join(tmpdir(), "packages-"));
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
vi.stubEnv("PACKAGE_STORAGE_DIR", packageDir);
// The scripted model answers at once here; in development it waits, as a real model would.
vi.stubEnv("SCRIPTED_MODEL_DELAY_MS", "0");
// Long enough for a job the stub finishes on submit, short enough that a running job doesn't slow the tests.
vi.stubEnv("CHAT_JOB_WAIT_MS", "300");
vi.stubEnv("CHAT_DATASETS", "trees,footprints");
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { query, truncateAllTables } = await import("../helpers/database.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");
const { JobsService } = await import("../../src/modules/jobs/jobs.service.js");
const { ChatsService } = await import("../../src/modules/chats/chats.service.js");
const { ModelClient, ModelUnavailableError } = await import("../../src/infra/model/model.client.js");

const treesSchema = {
  type: "object",
  properties: {
    bounds: { type: "array", items: { type: "number" } },
    tree_type: { enum: ["urban", "mixed", "dense", "arid"], default: "urban" },
    format: { enum: ["tif", "gpkg", "geojson"], default: null },
  },
  required: ["bounds"],
};

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
    await engine.close();
    await rm(packageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await truncateAllTables();
    engine.reset();
    engine.setDatasets([
      descriptor("trees", { title: "Trees", args_schema: treesSchema }),
      descriptor("footprints", { title: "Building footprints" }),
      descriptor("smoke", { title: "Smoke" }),
    ]);
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

  describe("Datasets as tools", () => {
    function lastEngineJobId(): string {
      const id = engine.submissions.at(-1)?.jobId;
      if (!id) throw new Error("The stub engine created no job");
      return id;
    }

    function assistantText(chat: Chat): string {
      return chat.entries.flatMap((entry) => (entry.type === "assistant" ? [entry.text] : [])).join("\n");
    }

    it("runs the Dataset the user asks for on the selected area, and says so while the job runs", async () => {
      const chat = await start(ada, "How many trees are in this area?");

      expect(engine.submissions.map((submission) => submission.body)).toEqual([
        { dataset: "trees", parameters: { bounds } },
      ]);
      expect(types(chat.entries)).toEqual(["user", "assistant", "job", "assistant"]);
      const [job] = chat.jobs;
      expect(job).toMatchObject({ dataset: "trees", state: "queued", userId: adaId });
      expect(chat.entries[2]).toMatchObject({ type: "job", jobId: job?.id, dataset: "trees" });
      expect(assistantText(chat)).toContain("running");
      expect(chat.waitingJobs).toBe(1);
    });

    it("answers in the same turn, from the job's manifest, when the job finishes within the wait", async () => {
      const packageBytes = await dtccPackage(manifestOf("trees", { summary: { tree_count: 1234 } }));
      engine.onSubmit((jobId) => {
        engine.completeJob(jobId, packageBytes);
      });

      const chat = await start(ada, "How many trees are in this area?");

      expect(chat.jobs[0]?.state).toBe("completed");
      expect(assistantText(chat)).toContain("tree_count: 1234");
      expect(chat.waitingJobs).toBe(0);
    });

    it("tells the model when the job fails within the wait", async () => {
      engine.onSubmit((jobId) => {
        engine.failJob(jobId, "UpstreamError");
      });

      const chat = await start(ada, "How many trees are in this area?");

      expect(chat.jobs[0]?.state).toBe("failed");
      expect(assistantText(chat)).toContain("UpstreamError");
      expect(chat.waitingJobs).toBe(0);
    });

    it("starts no job without a selected area, and tells the model to ask for one", async () => {
      const chat = await start(ada, "How many trees are in this area?", null);

      expect(engine.submissions).toEqual([]);
      expect(chat.jobs).toEqual([]);
      expect(assistantText(chat)).toContain("No area is selected");
    });

    it("hands the engine's rejection of the parameters back to the model", async () => {
      engine.rejectNextSubmit(422, [{ loc: ["tree_type"], type: "literal_error" }]);

      const chat = await start(ada, "Trees, please");

      expect(chat.jobs).toEqual([]);
      expect(assistantText(chat)).toContain("parameters.tree_type");
    });

    it("hands an engine that can't take the job back to the model", async () => {
      engine.rejectNextSubmit(503, "The job queue is unavailable; the job was not submitted");

      const chat = await start(ada, "Trees, please");

      expect(chat.jobs).toEqual([]);
      expect(assistantText(chat)).toContain("DTCC Engine is unavailable");
    });

    it("runs several Datasets asked for at once in one step", async () => {
      const chat = await start(ada, "Show me trees and footprints here");

      const datasets = engine.submissions.map((submission) => (submission.body as { dataset: string }).dataset);
      expect(datasets.toSorted()).toEqual(["footprints", "trees"]);
      expect(types(chat.entries)).toEqual(["user", "assistant", "job", "job", "assistant"]);
      expect(chat.waitingJobs).toBe(2);
    });

    it("offers only the Datasets CHAT_DATASETS allows", async () => {
      const chat = await start(ada, "Run smoke here");

      expect(engine.submissions).toEqual([]);
      expect(types(chat.entries)).toEqual(["user", "assistant"]);
    });

    it("lets the model look up a job, which counts as seeing it finish", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees", { summary: { tree_count: 7 } })));
      await app.get(JobsService).refreshActive();

      const continued = await send(ada, chat.id, "Is it done yet?");

      expect(assistantText(continued)).toContain("tree_count: 7");
      expect(continued.waitingJobs).toBe(0);
    });

    it("leaves the jobs it started to the user when the chat is deleted", async () => {
      const chat = await start(ada, "How many trees are in this area?");

      await ada.delete(`/api/chats/${chat.id}`).expect(204);

      const jobs = jobPageSchema.parse((await ada.get("/api/jobs").expect(200)).body);
      expect(jobs.items.map((job) => job.id)).toEqual(chat.jobs.map((job) => job.id));
    });
  });

  describe("Finished jobs", () => {
    // What the two background watchers do on each run; the tests run them themselves.
    async function backgroundRun(): Promise<void> {
      await app.get(JobsService).refreshActive();
      await app.get(ChatsService).resumeFinished();
    }

    async function read(chatId: string): Promise<Chat> {
      return chatSchema.parse((await ada.get(`/api/chats/${chatId}`).expect(200)).body);
    }

    function lastEngineJobId(): string {
      const id = engine.submissions.at(-1)?.jobId;
      if (!id) throw new Error("The stub engine created no job");
      return id;
    }

    function lastAssistantText(chat: Chat): string {
      const entry = chat.entries.findLast((candidate) => candidate.type === "assistant");
      return entry?.type === "assistant" ? entry.text : "";
    }

    const started = ["user", "assistant", "job", "assistant"];

    it("reports a job that finishes after its turn, in a turn of its own", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees", { summary: { tree_count: 42 } })));

      await backgroundRun();

      const reported = await read(chat.id);
      expect(types(reported.entries)).toEqual([...started, "job_update", "assistant"]);
      expect(reported.entries[4]).toMatchObject({ type: "job_update", jobId: chat.jobs[0]?.id, state: "completed" });
      expect(lastAssistantText(reported)).toContain("tree_count: 42");
      expect(reported).toMatchObject({ waitingJobs: 0, answering: false });
      const turns = await query<{ trigger: string }>("select trigger from chat_turns order by created_at");
      expect(turns.map((turn) => turn.trigger)).toEqual(["message", "job_update"]);
    });

    it("reports each job once", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees")));

      await backgroundRun();
      await backgroundRun();

      expect(types((await read(chat.id)).entries)).toEqual([...started, "job_update", "assistant"]);
    });

    it("waits while the job runs", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.setJob(lastEngineJobId(), "running", { percent: 40, message: null, phase: null });

      await backgroundRun();

      const waiting = await read(chat.id);
      expect(types(waiting.entries)).toEqual(started);
      expect(waiting.waitingJobs).toBe(1);
    });

    it("reports a job that failed", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.failJob(lastEngineJobId(), "UpstreamError");

      await backgroundRun();

      const reported = await read(chat.id);
      expect(reported.entries.at(-2)).toMatchObject({ type: "job_update", state: "failed" });
      expect(lastAssistantText(reported)).toContain("UpstreamError");
    });

    it("reports jobs that finished by the same run in one update, answered once", async () => {
      const chat = await start(ada, "Show me trees and footprints here");
      for (const submission of engine.submissions) {
        engine.completeJob(submission.jobId ?? "", await dtccPackage(manifestOf("trees")));
      }

      await backgroundRun();

      const reported = await read(chat.id);
      expect(types(reported.entries)).toEqual([
        ...started.slice(0, 3),
        "job",
        "assistant",
        "job_update",
        "job_update",
        "assistant",
      ]);
      expect(reported.waitingJobs).toBe(0);
    });

    it("waits for a turn running in the chat, and reports once it has ended", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees")));
      await query("update chats set turn_started_at = now() where id = $1", [chat.id]);

      await backgroundRun();
      expect(types((await read(chat.id)).entries)).toEqual(started);

      await query("update chats set turn_started_at = null where id = $1", [chat.id]);
      await backgroundRun();
      expect(types((await read(chat.id)).entries)).toEqual([...started, "job_update", "assistant"]);
    });

    it("tells the model how a job ended before it reads the user's next message", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees", { summary: { tree_count: 9 } })));
      await app.get(JobsService).refreshActive();

      const continued = await send(ada, chat.id, "Thanks");

      expect(types(continued.entries)).toEqual([...started, "job_update", "user", "assistant"]);
      expect(lastAssistantText(continued)).toContain("tree_count: 9");
      expect(lastAssistantText(continued)).toContain("Thanks");
    });

    it("keeps the update when the model can't answer it, so the next turn still sees it", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees")));
      vi.spyOn(app.get(ModelClient), "reply").mockRejectedValueOnce(new ModelUnavailableError("Bedrock is down"));

      await backgroundRun();

      const reported = await read(chat.id);
      expect(types(reported.entries)).toEqual([...started, "job_update", "notice"]);
      expect(reported.waitingJobs).toBe(0);
    });

    it("forgets the jobs of a deleted chat, which stay the user's", async () => {
      const chat = await start(ada, "How many trees are in this area?");
      engine.completeJob(lastEngineJobId(), await dtccPackage(manifestOf("trees")));
      await ada.delete(`/api/chats/${chat.id}`).expect(204);

      await backgroundRun();

      const jobs = jobPageSchema.parse((await ada.get("/api/jobs").expect(200)).body);
      expect(jobs.items.map((job) => job.state)).toEqual(["completed"]);
      expect(await query("select id from chat_turns where trigger = 'job_update'")).toEqual([]);
    });
  });
});
