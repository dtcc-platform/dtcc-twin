import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  datasetNameParamsSchema,
  datasetPageSchema,
  datasetSchema,
  offsetPaginationQuerySchema,
  type Dataset,
  type DatasetNameParams,
  type DatasetPage,
  type OffsetPaginationQuery,
} from "@repo/contracts";
import { Public } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { DatasetsService } from "./datasets.service.js";

@Controller("datasets")
@Public()
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get()
  @Serialize(datasetPageSchema)
  list(@Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery): Promise<DatasetPage> {
    return this.datasets.list(query);
  }

  @Get(":name")
  @Serialize(datasetSchema)
  get(@Param({ schema: datasetNameParamsSchema }) { name }: DatasetNameParams): Promise<Dataset> {
    return this.datasets.get(name);
  }
}
