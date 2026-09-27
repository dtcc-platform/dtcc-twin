import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { redactQueryParams } from "./database-error.js";
import { toErrorBody } from "./to-error-body.js";

const requestId = "request-1";

// What Drizzle throws: the driver's error as `cause`, the SQL and its parameters alongside.
function queryError(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError('insert into "users" ("email") values ($1)', ["ada@example.com"], cause);
}

function postgresError(code: string, message = "postgres error"): Error {
  return Object.assign(new Error(message), { code });
}

describe("toErrorBody, for errors a query throws", () => {
  it("answers a unique violation (23505) with CONFLICT, without echoing the values", () => {
    const body = toErrorBody(queryError(postgresError("23505", "duplicate key value")), requestId);

    expect(body).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(body.message).not.toContain("ada@example.com");
  });

  it("answers a foreign key violation (23503) with CONFLICT", () => {
    expect(toErrorBody(queryError(postgresError("23503")), requestId)).toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it.each([
    ["a refused connection", postgresError("ECONNREFUSED")],
    ["a reset connection", postgresError("ECONNRESET")],
    ["a Postgres connection exception (class 08)", postgresError("08006")],
    ["a server shutting down (57P01)", postgresError("57P01")],
    ["too many connections (53300)", postgresError("53300")],
    ["the pool's connection timeout", new Error("timeout exceeded when trying to connect")],
    ["a connection dropped mid-query", new Error("Connection terminated unexpectedly")],
  ])("answers %s with SERVICE_UNAVAILABLE", (_case, cause) => {
    expect(toErrorBody(queryError(cause), requestId)).toEqual({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
      requestId,
    });
  });

  it.each([
    ["a NOT NULL violation (23502)", "23502"],
    ["a CHECK violation (23514)", "23514"],
    ["a value too long for its column (22001)", "22001"],
    ["an unknown table (42P01)", "42P01"],
  ])("leaves %s as an INTERNAL_ERROR: request validation should have stopped it", (_case, code) => {
    expect(toErrorBody(queryError(postgresError(code)), requestId)).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });

  it("does not claim a refused connection that no query threw, such as another service's", () => {
    expect(toErrorBody(postgresError("ECONNREFUSED"), requestId)).toMatchObject({ status: 500 });
  });
});

describe("redactQueryParams", () => {
  it("keeps the driver's message and the SQL but drops the parameters, from the message and the stack", () => {
    const error = queryError(postgresError("23502", 'null value in column "name" violates not-null constraint'));

    const redacted = redactQueryParams(error);

    expect(redacted.message).toContain('null value in column "name"');
    expect(redacted.message).toContain('insert into "users"');
    expect(`${redacted.message}\n${redacted.stack ?? ""}`).not.toContain("ada@example.com");
  });

  it.each([
    ["an unknown table (42P01)", "42P01"],
    ["an unknown column (42703)", "42703"],
  ])("suggests `pnpm db:push` for %s, the usual cause in development", (_case, code) => {
    expect(redactQueryParams(queryError(postgresError(code))).message).toContain("pnpm db:push");
    expect(redactQueryParams(queryError(postgresError("23502"))).message).not.toContain("pnpm db:push");
  });

  it("returns any other error as it is", () => {
    const error = new Error("boom");

    expect(redactQueryParams(error)).toBe(error);
  });
});
