import { ConflictException, ServiceUnavailableException, type HttpException } from "@nestjs/common";

// Drizzle's query error, matched by shape because common/ does not depend on the database layer.
type QueryError = Error & {
  query: string;
  params: unknown[];
  cause?: unknown;
};

function isQueryError(error: unknown): error is QueryError {
  return error instanceof Error && "query" in error && typeof error.query === "string" && "params" in error;
}

// A Postgres SQLSTATE, or a Node socket error such as ECONNREFUSED.
function driverCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
}

const conflicts: Partial<Record<string, string>> = {
  "23505": "Conflicts with an existing record",
  "23503": "Refers to a record that does not exist, or is still referred to by one",
};

// pg-pool's own failures carry no code, so they are matched by message.
const unavailableCodes = new Set(["53300", "57P01", "57P02", "57P03", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);
const unavailableMessages = ["timeout exceeded when trying to connect", "Connection terminated"];

/**
 * 409 for a conflict with existing data, 503 for an unreachable database. Anything else (a NOT NULL
 * violation, an unknown table) means code and schema disagree, so it stays a 500.
 */
export function fromDatabaseError(error: unknown): HttpException | undefined {
  if (!isQueryError(error) || !(error.cause instanceof Error)) return undefined;
  const { cause } = error;
  const code = driverCode(cause);

  const conflict = code === undefined ? undefined : conflicts[code];
  if (conflict) return new ConflictException(conflict);
  if (
    (code !== undefined && (code.startsWith("08") || unavailableCodes.has(code))) ||
    unavailableMessages.some((message) => cause.message.startsWith(message))
  ) {
    return new ServiceUnavailableException("Database unavailable");
  }
  return undefined;
}

// Drizzle puts query parameters (emails, password hashes) in its message; logs keep only the SQL.
export function redactQueryParams(error: Error): Error {
  if (!isQueryError(error)) return error;
  const reason = error.cause instanceof Error ? error.cause.message : "Query failed";
  // Unknown table or column: in development, nearly always a schema change not pushed yet.
  const hint = ["42P01", "42703"].includes(driverCode(error.cause) ?? "") ? "\nhint: run `pnpm db:push`?" : "";
  const redacted = new Error(`${reason}\nquery: ${error.query}${hint}`);
  if (error.stack) redacted.stack = error.stack.replace(error.message, redacted.message);
  return redacted;
}
