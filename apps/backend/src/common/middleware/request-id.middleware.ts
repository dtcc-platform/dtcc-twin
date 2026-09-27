import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare module "http" {
  interface IncomingMessage {
    id: string;
  }
}

/**
 * An id per request, sent back in `X-Request-Id` and in error bodies. Express middleware rather than
 * Nest's, which runs after the body parsers: a request they reject still needs an id.
 */
export function requestId(request: Request, response: Response, next: NextFunction): void {
  request.id = randomUUID();
  response.setHeader("X-Request-Id", request.id);
  next();
}
