import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Valkey } from "iovalkey";
import type { Env } from "../../config/env.schema.js";
import { InjectValkey } from "../../infra/valkey/valkey.module.js";

const hourMs = 3_600_000;
// Longer than the hour, so a slot given back as the hour ends still finds its key.
const keyTtlSeconds = 7_200;

/** A submission's place in its user's count for one clock hour. */
export type JobSlot = { key: string };

/** The per-user limit on job submissions per clock hour, counted in Valkey. */
@Injectable()
export class JobLimit {
  private readonly logger = new Logger(JobLimit.name);
  private readonly limit: number;

  constructor(
    @InjectValkey() private readonly valkey: Valkey,
    config: ConfigService<Env, true>,
  ) {
    this.limit = config.get("JOB_LIMIT_PER_HOUR", { infer: true });
  }

  /** Takes one of the user's submissions this clock hour; throws 429 when none is left, and 503 without Valkey. */
  async take(userId: string): Promise<JobSlot> {
    const now = Date.now();
    const slot = { key: `job-limit:${userId}:${String(Math.floor(now / hourMs))}` };
    let count: number;
    try {
      count = await this.valkey.incr(slot.key);
      if (count === 1) await this.valkey.expire(slot.key, keyTtlSeconds);
    } catch (error) {
      this.logger.error(`Counting a job submission failed: ${messageOf(error)}`);
      throw new ServiceUnavailableException("Valkey unavailable");
    }
    if (count > this.limit) {
      // Otherwise refused attempts would push the count past the limit, and a slot given back wouldn't free one.
      await this.giveBack(slot);
      throw new HttpException(limitMessage(this.limit, now), HttpStatus.TOO_MANY_REQUESTS);
    }
    return slot;
  }

  /** Gives back the slot of a submission the engine never accepted. If that fails, the slot stays used for the hour. */
  async giveBack(slot: JobSlot): Promise<void> {
    try {
      await this.valkey.decr(slot.key);
    } catch (error) {
      this.logger.error(`Giving back a job slot failed: ${messageOf(error)}`);
    }
  }
}

/** The 429's message: the limit, and the minutes until the next clock hour, rounded up. */
export function limitMessage(limit: number, now: number): string {
  const minutes = Math.ceil((hourMs - (now % hourMs)) / 60_000);
  return `You can run up to ${counted(limit, "job")} an hour. Try again in ${counted(minutes, "minute")}.`;
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
