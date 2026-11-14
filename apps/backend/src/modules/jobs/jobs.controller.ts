import { Body, Controller, Get, Param, Post, Query, StreamableFile } from "@nestjs/common";
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
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { FileResponse } from "../../common/decorators/file-response.decorator.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { JobsService, type JobFile } from "./jobs.service.js";

@Controller("jobs")
@Roles("user")
export class JobsController {
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
  ): Promise<StreamableFile> {
    return toStreamableFile(await this.jobs.package(user.userId, id));
  }

  @Get(":id/artifact")
  @FileResponse("application/geo+json", "image/png", "image/tiff")
  async artifact(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
  ): Promise<StreamableFile> {
    return toStreamableFile(await this.jobs.artifact(user.userId, id));
  }

  @Post()
  @Serialize(jobSchema)
  create(@CurrentUser() user: AuthUser, @Body({ schema: createJobBodySchema }) body: CreateJobBody): Promise<Job> {
    return this.jobs.create(user.userId, body);
  }
}

function toStreamableFile({ content, fileName, mediaType }: JobFile): StreamableFile {
  return new StreamableFile(content, { type: mediaType, disposition: `attachment; filename="${fileName}"` });
}
