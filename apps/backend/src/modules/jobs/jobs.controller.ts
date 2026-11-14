import { Body, Controller, Get, HttpStatus, Logger, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import {
  createJobBodySchema,
  idParamsSchema,
  jobPageSchema,
  jobSchema,
  offsetPaginationQuerySchema,
  type CreateJobBody,
  type IdParams,
  type Job,
  type JobPage,
  type OffsetPaginationQuery,
} from "@repo/contracts";
import type { Response } from "express";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { FileResponse } from "../../common/decorators/file-response.decorator.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { JobsService, type JobFile } from "./jobs.service.js";

@Controller("jobs")
@Roles("user")
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(private readonly jobs: JobsService) {}

  @Get()
  @Serialize(jobPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery,
  ): Promise<JobPage> {
    return this.jobs.list(user.userId, query);
  }

  @Get(":id")
  @Serialize(jobSchema)
  get(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<Job> {
    return this.jobs.get(user.userId, id);
  }

  @Get(":id/package")
  @FileResponse("application/zip")
  async package(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.send(await this.jobs.package(user.userId, id), response);
  }

  @Get(":id/artifact")
  @FileResponse("application/geo+json", "image/png", "image/tiff")
  async artifact(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.send(await this.jobs.artifact(user.userId, id), response);
  }

  @Post()
  @Serialize(jobSchema)
  create(@CurrentUser() user: AuthUser, @Body({ schema: createJobBodySchema }) body: CreateJobBody): Promise<Job> {
    return this.jobs.create(user.userId, body);
  }

  /** A job's file as the response: a read error fails it as a server error, and a cancelled one closes the file. */
  private send({ content, fileName, mediaType }: JobFile, response: Response): StreamableFile {
    // Nest pipes the file into the response, and stops without closing it when the client goes away.
    response.once("close", () => content.destroy());
    const file = new StreamableFile(content, { type: mediaType, disposition: `attachment; filename="${fileName}"` });
    // In place of Nest's default, which answers 400 with the error's message.
    return file.setErrorHandler((error) => {
      this.logger.error(`Sending ${fileName} failed: ${error.message}`);
      if (response.headersSent) response.destroy(error);
      else response.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
    });
  }
}
