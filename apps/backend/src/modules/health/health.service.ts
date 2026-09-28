import { Injectable, Logger, ServiceUnavailableException, type BeforeApplicationShutdown } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { sql } from "drizzle-orm";
import type { Database } from "../../infra/database/database.js";

@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private shuttingDown = false;

  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Throws 503 while this instance should not receive traffic. */
  async assertReady(): Promise<void> {
    if (this.shuttingDown) throw new ServiceUnavailableException("Shutting down");
    try {
      await this.db.execute(sql`select 1`);
    } catch (error) {
      // Message only: a pg error carries its client's password.
      this.logger.error(`Database check failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException("Database unavailable");
    }
  }

  // Readiness fails before Nest closes the server, so load balancers stop routing here first.
  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}
