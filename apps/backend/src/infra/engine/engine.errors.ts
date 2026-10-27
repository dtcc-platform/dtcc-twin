import { ServiceUnavailableException } from "@nestjs/common";

export class EngineUnavailableError extends ServiceUnavailableException {
  constructor() {
    super("DTCC Engine is unavailable");
  }
}
