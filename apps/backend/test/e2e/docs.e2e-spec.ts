import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";
import { errorCodeSchema } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/create-test-app.js";

const json = "application/json";

describe("API docs (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("documents a route's body, response and the error envelope from the contracts", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs/openapi.json").expect(200);
    const doc = response.body as OpenAPIObject;

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/items"]).toMatchObject({
      post: {
        requestBody: {
          content: {
            [json]: {
              schema: {
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 100 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "201": { content: { [json]: { schema: { properties: { id: { type: "string", format: "uuid" } } } } } },
          default: {
            content: {
              [json]: {
                schema: { properties: { error: { properties: { code: { enum: errorCodeSchema.options } } } } },
              },
            },
          },
        },
      },
    });
  });

  it("documents query, path parameters and a bodiless route", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs/openapi.json").expect(200);
    const doc = response.body as OpenAPIObject;

    expect(doc.paths["/api/items"]).toMatchObject({
      get: {
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
        ],
      },
    });
    expect(doc.paths["/api/items/{id}"]).toMatchObject({
      get: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { content: { [json]: { schema: { properties: { id: { format: "uuid" } } } } } } },
      },
      delete: { responses: { "204": {} } },
    });
    expect(doc.paths["/api/health/live"]).toMatchObject({
      get: { responses: { "200": { content: { [json]: { schema: { properties: { status: { enum: ["ok"] } } } } } } } },
    });
  });

  it("documents a POST's status: 201 by default, the @HttpCode when one is set", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs/openapi.json").expect(200);
    const doc = response.body as OpenAPIObject;
    const userBody = { content: { [json]: { schema: { properties: { email: { format: "email" } } } } } };

    expect(doc.paths["/api/auth/register"]).toMatchObject({ post: { responses: { "201": userBody } } });
    expect(doc.paths["/api/auth/login"]).toMatchObject({ post: { responses: { "200": userBody } } });
  });

  it("serves the docs UI and its scripts through helmet", async () => {
    await request(app.getHttpServer()).get("/api/docs").expect(200).expect("content-type", /html/);
    await request(app.getHttpServer()).get("/api/docs/swagger-ui-init.js").expect(200);
    await request(app.getHttpServer()).get("/api/docs/swagger-ui-bundle.js").expect(200);
  });
});
