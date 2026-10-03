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
import { JobsService } from "./jobs.service.js";

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
    const { content, fileName } = await this.jobs.package(user.userId, id);
    return new StreamableFile(content, { type: "application/zip", disposition: `attachment; filename="${fileName}"` });
  }

  @Post()
  @Serialize(jobSchema)
  create(@CurrentUser() user: AuthUser, @Body({ schema: createJobBodySchema }) body: CreateJobBody): Promise<Job> {
    return this.jobs.create(user.userId, body);
  }
}
