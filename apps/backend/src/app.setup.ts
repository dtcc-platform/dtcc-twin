import { StandardSchemaSerializerInterceptor, StandardSchemaValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost, Reflector } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ValidationException } from "./common/errors/validation.exception.js";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { requestId } from "./common/middleware/request-id.middleware.js";
import type { EnvConfigService } from "./config/env.schema.js";
import { setupDocs } from "./docs/setup-docs.js";

export function configureApp(app: NestExpressApplication): void {
  const config: EnvConfigService = app.get(ConfigService);

  app.setGlobalPrefix("/api");
  app.use(requestId);
  app.use(helmet());
  app.enableCors({ origin: config.get("CORS_ORIGINS", { infer: true }), credentials: true });
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "3mb" });
  // Validates every parameter declared with a schema, such as @Body({ schema }).
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({ exceptionFactory: (issues) => new ValidationException(issues) }),
  );
  // Parses every response with its handler's @SerializeOptions({ schema }), dropping undeclared properties.
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  if (config.get("NODE_ENV", { infer: true }) !== "production") setupDocs(app);
  app.enableShutdownHooks();
}
