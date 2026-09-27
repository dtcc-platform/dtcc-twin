import { Injectable, NotFoundException } from "@nestjs/common";
import type { Dataset, DatasetPage, OffsetPaginationQuery } from "@repo/contracts";
import { EngineClient } from "../engine/engine.client.js";
import type { EngineDataset } from "../engine/engine.schemas.js";

@Injectable()
export class DatasetsService {
  constructor(private readonly engine: EngineClient) {}

  async list({ limit, offset }: OffsetPaginationQuery): Promise<DatasetPage> {
    const datasets = await this.engine.listDatasets();
    const items = datasets.slice(offset, offset + limit).map(toDataset);
    return { items, limit, offset, total: datasets.length };
  }

  async get(name: string): Promise<Dataset> {
    const datasets = await this.engine.listDatasets();
    const dataset = datasets.find((candidate) => candidate.name === name);
    if (!dataset) throw new NotFoundException(`Dataset ${name} not found`);
    return toDataset(dataset);
  }
}

function toDataset(dataset: EngineDataset): Dataset {
  return {
    name: dataset.name,
    title: dataset.title,
    description: dataset.description,
    dataCategory: dataset.data_category,
    resultKind: dataset.result_kind,
    argsSchema: dataset.args_schema,
    timeoutHint: dataset.timeout_hint,
    available: dataset.available,
  };
}
