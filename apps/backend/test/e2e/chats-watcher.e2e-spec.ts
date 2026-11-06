import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { chatSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dtccPackage, manifestOf } from "../helpers/packages.js";
import { descriptor, startStubEngine } from "../helpers/stub-engine.js";

// The other files turn background work off and run it themselves; this one checks that the two watchers, on their
// own, carry a job that outlives its turn back into its chat.
const engine = await startStubEngine();
const packageDir = await mkdtemp(join(tmpdir(), "packages-"));
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
vi.stubEnv("PACKAGE_STORAGE_DIR", packageDir);
vi.stubEnv("SCRIPTED_MODEL_DELAY_MS", "0");
vi.stubEnv("CHAT_JOB_WAIT_MS", "0");
vi.stubEnv("JOBS_REFRESH_INTERVAL_SECONDS", "1");
vi.stubEnv("CHAT_RESUME_INTERVAL_SECONDS", "1");
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");

describe("Chats background resume (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await engine.close();
    await rm(packageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("posts a job's result in its chat once the job ends, without being asked", async () => {
    engine.setDatasets([descriptor("trees", { title: "Trees" })]);
    const user = await app
      .get(UsersService)
      .create({ email: "ada@example.com", name: "Ada", password: "correct horse" });
    const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
    const started = await agent
      .post("/api/chats")
      .send({ text: "How many trees are in this area?", bounds: [319891, 6399790, 320091, 6399990] })
      .expect(201);
    const chatId = chatSchema.parse(started.body).id;

    engine.completeJob(engine.submissions.at(-1)?.jobId ?? "", await dtccPackage(manifestOf("trees")));

    await vi.waitFor(
      async () => {
        const chat = chatSchema.parse((await agent.get(`/api/chats/${chatId}`).expect(200)).body);
        expect(chat.entries.map((entry) => entry.type).slice(-2)).toEqual(["job_update", "assistant"]);
      },
      { timeout: 8000, interval: 250 },
    );
  });
});
