import { Body, Controller, Get, Patch } from "@nestjs/common";
import { settingsSchema, updateSettingsBodySchema, type Settings, type UpdateSettingsBody } from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { SettingsService } from "./settings.service.js";

// The logged-in user's one record: no id, no POST or DELETE. PATCH creates it; deleting the user deletes it.
@Controller("settings")
@Roles("user")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Serialize(settingsSchema)
  get(@CurrentUser() user: AuthUser): Promise<Settings> {
    return this.settings.get(user.userId);
  }

  @Patch()
  @Serialize(settingsSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Body({ schema: updateSettingsBodySchema }) body: UpdateSettingsBody,
  ): Promise<Settings> {
    return this.settings.update(user.userId, body);
  }
}
