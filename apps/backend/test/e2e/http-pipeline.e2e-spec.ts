import { Body, Controller, Get, INestApplication, Logger, Post, SerializeOptions } from "@nestjs/common";
import { errorResponseSchema, itemSchema, updateItemBodySchema, type Item, type UpdateItemBody } from "@repo/contracts";
import { DrizzleQueryError } from "drizzle-orm";
import request from "supertest";
import { Public } from "../../src/common/decorators/auth.decorators.js";
import type { App } from "supertest/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../helpers/create-test-app.js";

const item: Item = {
  id: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
  userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c",
  name: "Widget",
  description: null,
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

// Public, so this spec stays about the HTTP pipeline; the guard has its own.
@Controller("test")
@Public()
class TestController {
  @Get("crash")
  crash(): never {
    throw new Error("password=hunter2");
  }

  @Get("failed-query")
  failedQuery(): never {
    const cause = Object.assign(new Error('null value in column "name" violates not-null constraint'), {
      code: "23502",
    });
    throw new DrizzleQueryError(
      'insert into "users" ("email", "name") values ($1, $2)',
      ["hunter2@example.com", null],
      cause,
    );
  }

  @Get("leaky")
  @SerializeOptions({ schema: itemSchema })
  leaky(): Item & { passwordHash: string } {
    return { ...item, passwordHash: "secret" };
  }

  @Get("off-contract")
  @SerializeOptions({ schema: itemSchema })
  offContract(): unknown {
    return { ...item, id: 42 };
  }

  @Post("echo")
  @SerializeOptions({ schema: updateItemBodySchema })
  echo(@Body({ schema: updateItemBodySchema }) body: UpdateItemBody): UpdateItemBody {
    return body;
  }
}

describe("HTTP pipeline (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [TestController] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves routes under /api", async () => {
    const response = await request(app.getHttpServer()).post("/api/test/echo").send({ name: "Widget" }).expect(201);

    expect(response.body).toEqual({ name: "Widget" });
  });

  it("answers an unknown route with a NOT_FOUND error", async () => {
    const response = await request(app.getHttpServer()).get("/api/nope").expect(404);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "Cannot GET /api/nope",
    });
  });

  it("returns the same request id in the header and the error body", async () => {
    const response = await request(app.getHttpServer()).get("/api/nope").expect(404);

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(errorResponseSchema.parse(response.body).error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("rejects malformed JSON with a BAD_REQUEST error", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/test/echo")
      .set("Content-Type", "application/json")
      .send('{"name":')
      .expect(400);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("hides unexpected errors behind a generic 500 and logs them", async () => {
    const logError = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const response = await request(app.getHttpServer()).get("/api/test/crash").expect(500);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.text).not.toContain("hunter2");
    // The id the client was handed is the one to search the logs for.
    expect(logError).toHaveBeenCalledWith(
      "password=hunter2",
      { requestId: response.headers["x-request-id"] },
      expect.stringContaining("TestController.crash"),
    );
  });

  it("logs a failed query with its SQL and the driver's message, but never its parameters", async () => {
    const logError = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await request(app.getHttpServer()).get("/api/test/failed-query").expect(500);

    expect(logError).toHaveBeenCalledOnce();
    const logged = JSON.stringify(logError.mock.calls[0]);
    expect(logged).toContain("violates not-null constraint");
    expect(logged).toContain('insert into \\"users\\"');
    expect(logged).not.toContain("hunter2");
  });

  it("strips properties the response schema does not declare", async () => {
    const response = await request(app.getHttpServer()).get("/api/test/leaky").expect(200);

    expect(response.body).toEqual(item);
  });

  it("fails closed when a response does not match its schema", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const response = await request(app.getHttpServer()).get("/api/test/off-contract").expect(500);

    expect(errorResponseSchema.parse(response.body).error).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
