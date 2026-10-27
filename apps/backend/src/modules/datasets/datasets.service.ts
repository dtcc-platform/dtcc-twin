import { Injectable, NotFoundException } from "@nestjs/common";
import type { Dataset, DatasetList } from "@repo/contracts";
import { EngineClient } from "../../infra/engine/engine.client.js";

@Injectable()
export class DatasetsService {
  constructor(private readonly engine: EngineClient) {}

  async list(): Promise<DatasetList> {
    const datasets = await this.engine.listDatasets();
    return { items: datasets.toSorted((a, b) => a.name.localeCompare(b.name)) };
  }

  async get(name: string): Promise<Dataset> {
    const dataset = await this.engine.getDataset(name);
    if (!dataset) throw new NotFoundException(`Dataset ${name} not found`);
    return dataset;
  }
}
