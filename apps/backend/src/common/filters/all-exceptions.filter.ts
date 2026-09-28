import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { ErrorResponse } from "@repo/contracts";
import type { Request } from "express";
import { redactQueryParams } from "../errors/database-error.js";
import { toErrorBody } from "../errors/to-error-body.js";

// Server errors are logged under the request id the client got, so a bug report leads to the stack.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const body = toErrorBody(exception, http.getRequest<Request>().id);

    if (body.status >= 500) {
      const error = redactQueryParams(exception instanceof Error ? exception : new Error(String(exception)));
      this.logger.error(error.message, { requestId: body.requestId }, error.stack);
    }

    const payload: ErrorResponse = { error: body };
    this.adapterHost.httpAdapter.reply(http.getResponse(), payload, body.status);
  }
}
