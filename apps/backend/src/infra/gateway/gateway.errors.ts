import { ServiceUnavailableException } from "@nestjs/common";

export class GatewayUnavailableError extends ServiceUnavailableException {
  constructor() {
    super("The API gateway is unavailable");
  }
}
