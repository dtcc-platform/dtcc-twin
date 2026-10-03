import { Controller, Get, Param } from "@nestjs/common";
import {
  datasetListSchema,
  datasetNameParamsSchema,
  datasetSchema,
  type Dataset,
  type DatasetList,
  type DatasetNameParams,
} from "@repo/contracts";
import { Roles } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { DatasetsService } from "./datasets.service.js";

// DTCC Engine's Datasets, which any logged-in user can run.
@Controller("datasets")
@Roles("user")
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get()
  @Serialize(datasetListSchema)
  list(): Promise<DatasetList> {
    return this.datasets.list();
  }

  @Get(":name")
  @Serialize(datasetSchema)
  get(@Param({ schema: datasetNameParamsSchema }) { name }: DatasetNameParams): Promise<Dataset> {
    return this.datasets.get(name);
  }
}
