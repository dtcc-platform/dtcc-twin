import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateSavedAreaBody,
  OffsetPaginationQuery,
  SavedArea,
  SavedAreaPage,
  UpdateSavedAreaBody,
} from "@repo/contracts";
import { SavedAreasRepository } from "./saved-areas.repository.js";

@Injectable()
export class SavedAreasService {
  constructor(private readonly repository: SavedAreasRepository) {}

  async list(userId: string, { limit, offset }: OffsetPaginationQuery): Promise<SavedAreaPage> {
    const { items, total } = await this.repository.findPage(userId, limit, offset);
    return { items, limit, offset, total };
  }

  create(userId: string, body: CreateSavedAreaBody): Promise<SavedArea> {
    return this.repository.insert(userId, body);
  }

  async update(userId: string, id: string, changes: UpdateSavedAreaBody): Promise<SavedArea> {
    const savedArea = await this.repository.update(userId, id, changes);
    if (!savedArea) throw new NotFoundException(`Saved area ${id} not found`);
    return savedArea;
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(userId, id);
    if (!deleted) throw new NotFoundException(`Saved area ${id} not found`);
  }
}
