import { Body, Controller, Get, Param, Post, Query, StreamableFile } from "@nestjs/common";
import {
  createJobBodySchema,
  idParamsSchema,
  jobArtifactParamsSchema,
  jobPageSchema,
  jobResultSchema,
  jobSchema,
  offsetPaginationQuerySchema,
  type CreateJobBody,
  type IdParams,
  type Job,
  type JobArtifactParams,
  type JobPage,
  type JobResult,
  type OffsetPaginationQuery,
} from "@repo/contracts";
import { Public } from "../../common/decorators/auth.decorators.js";
import { FileResponse, Serialize } from "../../common/decorators/serialize.decorator.js";
import { JobsService, type JobFile } from "./jobs.service.js";

@Controller("jobs")
@Public()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @Serialize(jobSchema)
  create(@Body({ schema: createJobBodySchema }) body: CreateJobBody): Promise<Job> {
    return this.jobs.create(body);
  }

  @Get()
  @Serialize(jobPageSchema)
  list(@Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery): Promise<JobPage> {
    return this.jobs.list(query);
  }

  @Get(":id")
  @Serialize(jobSchema)
  get(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<Job> {
    return this.jobs.get(id);
  }

  @Get(":id/result")
  @Serialize(jobResultSchema)
  result(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<JobResult> {
    return this.jobs.result(id);
  }

  @Get(":id/artifacts/:file")
  @FileResponse()
  async artifact(@Param({ schema: jobArtifactParamsSchema }) { id, file }: JobArtifactParams): Promise<StreamableFile> {
    const artifact = await this.jobs.artifact(id, file);
    return toStreamableFile(artifact, "inline");
  }

  @Get(":id/package")
  @FileResponse()
  async package(@Param({ schema: idParamsSchema }) { id }: IdParams): Promise<StreamableFile> {
    const archive = await this.jobs.package(id);
    return toStreamableFile(archive, "attachment");
  }
}

function toStreamableFile(file: JobFile, disposition: "inline" | "attachment"): StreamableFile {
  return new StreamableFile(file.content, {
    type: file.mediaType,
    disposition: `${disposition}; filename="${file.fileName}"`,
    length: file.content.byteLength,
  });
}
