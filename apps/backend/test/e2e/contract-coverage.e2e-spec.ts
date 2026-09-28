import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  SerializeOptions,
  type Type,
} from "@nestjs/common";
import { DiscoveryModule, DiscoveryService } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/create-test-app.js";
import { findContractViolations } from "../helpers/route-contract.js";

@Controller("broken")
class BrokenController {
  @Get()
  list(): string[] {
    return [];
  }

  @Post(":id")
  create(@Param("id") id: string, @Body() body: unknown): { id: string; body: unknown } {
    return { id, body };
  }

  @Get("options")
  @SerializeOptions({})
  options(): string[] {
    return [];
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): null {
    return null;
  }
}

describe("Contract coverage", () => {
  it("names each route that skips a response or request schema", () => {
    expect(findContractViolations([BrokenController])).toEqual([
      "GET /api/broken declares no response schema (@Serialize)",
      "POST /api/broken/:id declares no response schema (@Serialize)",
      "POST /api/broken/:id @Param at index 0 declares no schema",
      "POST /api/broken/:id @Body at index 1 declares no schema",
      "GET /api/broken/options declares no response schema (@Serialize)",
    ]);
  });

  it("finds no such route in the app", async () => {
    const app = await createTestApp({ imports: [DiscoveryModule] });
    const controllers = app
      .get(DiscoveryService)
      .getControllers()
      .flatMap((wrapper) => (wrapper.metatype ? [wrapper.metatype as Type] : []));
    await app.close();

    expect(controllers.length).toBeGreaterThan(0);
    expect(findContractViolations(controllers)).toEqual([]);
  });
});
