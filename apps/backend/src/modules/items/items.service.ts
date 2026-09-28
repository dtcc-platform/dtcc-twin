import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateItemBody, Item, ItemPage, OffsetPaginationQuery, UpdateItemBody } from "@repo/contracts";
import { ItemsRepository } from "./items.repository.js";

@Injectable()
export class ItemsService {
  constructor(private readonly repository: ItemsRepository) {}

  async list(userId: string, { limit, offset }: OffsetPaginationQuery): Promise<ItemPage> {
    const { items, total } = await this.repository.findPage(userId, limit, offset);
    return { items, limit, offset, total };
  }

  async get(userId: string, id: string): Promise<Item> {
    const item = await this.repository.findById(userId, id);
    if (!item) throw new NotFoundException(`Item ${id} not found`);
    return item;
  }

  create(userId: string, body: CreateItemBody): Promise<Item> {
    return this.repository.insert(userId, body);
  }

  async update(userId: string, id: string, changes: UpdateItemBody): Promise<Item> {
    const item = await this.repository.update(userId, id, changes);
    if (!item) throw new NotFoundException(`Item ${id} not found`);
    return item;
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(userId, id);
    if (!deleted) throw new NotFoundException(`Item ${id} not found`);
  }
}
