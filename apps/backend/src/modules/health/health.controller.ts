import { Controller, Get } from "@nestjs/common";
import { healthStatusSchema, type HealthStatus } from "@repo/contracts";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { Public } from "../../common/decorators/auth.decorators.js";
import { HealthService } from "./health.service.js";

// Load balancers and orchestrators probe these without credentials.
@Controller("health")
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @Serialize(healthStatusSchema)
  live(): HealthStatus {
    return { status: "ok" };
  }

  @Get("ready")
  @Serialize(healthStatusSchema)
  async ready(): Promise<HealthStatus> {
    await this.health.assertReady();
    return { status: "ok" };
  }
}
