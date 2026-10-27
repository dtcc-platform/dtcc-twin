import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createSavedAreaBodySchema,
  idParamsSchema,
  offsetPaginationQuerySchema,
  savedAreaPageSchema,
  savedAreaSchema,
  updateSavedAreaBodySchema,
  type CreateSavedAreaBody,
  type IdParams,
  type OffsetPaginationQuery,
  type SavedArea,
  type SavedAreaPage,
  type UpdateSavedAreaBody,
} from "@repo/contracts";
import { CurrentUser, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { SavedAreasService } from "./saved-areas.service.js";

// The logged-in user's own saved areas; nobody, admins included, reaches another user's here.
@Controller("saved-areas")
@Roles("user")
export class SavedAreasController {
  constructor(private readonly savedAreas: SavedAreasService) {}

  @Get()
  @Serialize(savedAreaPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: offsetPaginationQuerySchema }) query: OffsetPaginationQuery,
  ): Promise<SavedAreaPage> {
    return this.savedAreas.list(user.userId, query);
  }

  @Post()
  @Serialize(savedAreaSchema)
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createSavedAreaBodySchema }) body: CreateSavedAreaBody,
  ): Promise<SavedArea> {
    return this.savedAreas.create(user.userId, body);
  }

  @Patch(":id")
  @Serialize(savedAreaSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Param({ schema: idParamsSchema }) { id }: IdParams,
    @Body({ schema: updateSavedAreaBodySchema }) body: UpdateSavedAreaBody,
  ): Promise<SavedArea> {
    return this.savedAreas.update(user.userId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.savedAreas.remove(user.userId, id);
  }
}
