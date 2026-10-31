import { randomBytes } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { maxApiKeysPerUser, type ApiKeyList, type CreateApiKeyBody, type CreatedApiKey } from "@repo/contracts";
import { GatewayClient } from "../../infra/gateway/gateway.client.js";
import { UsersService } from "../users/users.service.js";
import { KeysRepository } from "./keys.repository.js";

const keyPrefix = "dtcc_";
const shownPrefixLength = 12;

/** A user's API keys. APISIX is written first whenever access goes, so the list never shows a key as gone while it works. */
@Injectable()
export class KeysService {
  constructor(
    private readonly repository: KeysRepository,
    private readonly gateway: GatewayClient,
    private readonly users: UsersService,
  ) {}

  async list(userId: string): Promise<ApiKeyList> {
    return { items: await this.repository.findAll(userId) };
  }

  /** For admins, who name the user in the URL: a missing user is a 404, not an empty list. */
  async listForUser(userId: string): Promise<ApiKeyList> {
    await this.users.get(userId);
    return this.list(userId);
  }

  async create(userId: string, body: CreateApiKeyBody): Promise<CreatedApiKey> {
    const user = await this.users.get(userId);
    if (user.status !== "active") throw new ForbiddenException("Only active accounts can create API keys");
    if ((await this.repository.count(userId)) >= maxApiKeysPerUser) {
      throw new ConflictException(`An account can have at most ${String(maxApiKeysPerUser)} API keys`);
    }

    const key = keyPrefix + randomBytes(32).toString("base64url");
    const apiKey = await this.repository.insert(userId, { ...body, prefix: key.slice(0, shownPrefixLength) });
    try {
      await this.gateway.putCredential(userId, apiKey.id, key);
    } catch (error) {
      // APISIX may have stored it before failing. If removing it fails too, it stays behind unlisted, but its key
      // never left the backend, so nobody can use it.
      await this.gateway.deleteCredential(userId, apiKey.id).catch(() => undefined);
      await this.repository.delete(userId, apiKey.id);
      throw error;
    }
    return { ...apiKey, key };
  }

  /** Revokes every key of the user by deleting their consumer, which stops all of them at once. */
  async revokeAll(userId: string): Promise<void> {
    // Without keys there is nothing to revoke, so disabling such a user doesn't depend on the gateway.
    if ((await this.repository.count(userId)) === 0) return;
    await this.gateway.deleteConsumer(userId);
    await this.repository.deleteAll(userId);
  }

  async revoke(userId: string, id: string): Promise<void> {
    const apiKey = await this.repository.findById(userId, id);
    if (!apiKey) throw new NotFoundException(`API key ${id} not found`);
    await this.gateway.deleteCredential(userId, id);
    await this.repository.delete(userId, id);
  }
}
