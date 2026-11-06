import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { jobSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStubEngine } from "../helpers/stub-engine.js";

// The other files turn the background refresh off and run it themselves; this one checks it runs on its own.
const engine = await startStubEngine();
const packageDir = await mkdtemp(join(tmpdir(), "packages-"));
vi.stubEnv("ENGINE_URL", engine.url);
vi.stubEnv("ENGINE_API_TOKEN", engine.token);
vi.stubEnv("PACKAGE_STORAGE_DIR", packageDir);
vi.stubEnv("JOBS_REFRESH_INTERVAL_SECONDS", "1");
const { createTestApp } = await import("../helpers/create-test-app.js");
const { authHeader } = await import("../helpers/auth.js");
const { UsersService } = await import("../../src/modules/users/users.service.js");

describe("Jobs background refresh (e2e)", () => {
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

  it("refreshes unfinished jobs every JOBS_REFRESH_INTERVAL_SECONDS without being asked", async () => {
    const user = await app
      .get(UsersService)
      .create({ email: "ada@example.com", name: "Ada", password: "correct horse" });
    const agent = request.agent(app.getHttpServer()).set(await authHeader("user", { userId: user.id }));
    const submitted = await agent.post("/api/jobs").send({ dataset: "smoke", parameters: { bounds: [0, 0, 1, 1] } });
    const jobId = jobSchema.parse(submitted.body).id;
    const engineJobId = engine.submissions.at(-1)?.jobId ?? "";

    engine.setJob(engineJobId, "running");

    await vi.waitFor(
      async () => {
        const job = jobSchema.parse((await agent.get(`/api/jobs/${jobId}`).expect(200)).body);
        expect(job.state).toBe("running");
      },
      { timeout: 5000, interval: 200 },
    );
  });
});
