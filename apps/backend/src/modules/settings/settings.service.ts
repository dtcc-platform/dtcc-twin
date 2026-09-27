import { Injectable } from "@nestjs/common";
import type { Settings, UpdateSettingsBody } from "@repo/contracts";
import { SettingsRepository } from "./settings.repository.js";
import { settingsDefaults } from "./settings.table.js";

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  /** No row until the first change; the defaults until then. */
  async get(userId: string): Promise<Settings> {
    const stored = await this.repository.findByUserId(userId);
    return stored ?? { userId, ...settingsDefaults };
  }

  // A user deleted since their token was issued fails the foreign key: 409.
  update(userId: string, changes: UpdateSettingsBody): Promise<Settings> {
    return this.repository.upsert(userId, changes);
  }
}
