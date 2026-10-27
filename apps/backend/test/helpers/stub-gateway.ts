import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Starts a fake APISIX Admin API on a random local port, keeping consumers and their `key-auth` credentials the way
 * APISIX does: a credential needs its consumer, deleting a consumer deletes its credentials, and deleting what isn't
 * there answers 404. Like APISIX, it answers 401 without the right `X-API-KEY`. Call `reset()` before each test and
 * `close()` after the file.
 */
export async function startStubGateway(adminKey = "stub-gateway-admin-key") {
  // Credential keys by credential id, by consumer username.
  let consumers = new Map<string, Map<string, string>>();
  let failing = false;
  let reachable = true;

  const server = createServer((request, response) => {
    if (!reachable) {
      request.socket.destroy();
      return;
    }
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://stub").pathname;
    const body = await readJson(request);
    if (request.headers["x-api-key"] !== adminKey) {
      send(response, 401, { message: "failed to check token" });
      return;
    }
    if (failing) {
      send(response, 500, { error_msg: "etcd unavailable" });
      return;
    }

    const consumerMatch = /^\/apisix\/admin\/consumers\/([^/]+)$/.exec(path);
    const credentialMatch = /^\/apisix\/admin\/consumers\/([^/]+)\/credentials\/([^/]+)$/.exec(path);

    if (request.method === "PUT" && path === "/apisix/admin/consumers") {
      const username = (body as { username?: unknown } | null)?.username;
      if (typeof username !== "string") {
        send(response, 400, { error_msg: "invalid configuration" });
        return;
      }
      const existed = consumers.has(username);
      if (!existed) consumers.set(username, new Map());
      send(response, existed ? 200 : 201, { key: `/apisix/consumers/${username}`, value: { username } });
    } else if (request.method === "DELETE" && consumerMatch) {
      const deleted = consumers.delete(decodeURIComponent(consumerMatch[1] ?? ""));
      send(response, deleted ? 200 : 404, deleted ? { deleted: "1" } : { message: "Key not found" });
    } else if (request.method === "PUT" && credentialMatch) {
      const credentials = consumers.get(decodeURIComponent(credentialMatch[1] ?? ""));
      const key = (body as { plugins?: { "key-auth"?: { key?: unknown } } } | null)?.plugins?.["key-auth"]?.key;
      if (!credentials) {
        send(response, 404, { error_msg: "consumer not found" });
      } else if (typeof key !== "string") {
        send(response, 400, { error_msg: "invalid plugins configuration" });
      } else {
        const id = decodeURIComponent(credentialMatch[2] ?? "");
        const existed = credentials.has(id);
        credentials.set(id, key);
        send(response, existed ? 200 : 201, { value: { id } });
      }
    } else if (request.method === "DELETE" && credentialMatch) {
      const credentials = consumers.get(decodeURIComponent(credentialMatch[1] ?? ""));
      const deleted = credentials?.delete(decodeURIComponent(credentialMatch[2] ?? "")) ?? false;
      send(response, deleted ? 200 : 404, deleted ? { deleted: "1" } : { message: "Key not found" });
    } else {
      send(response, 404, { error_msg: "404 Route Not Found" });
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    adminKey,

    /** The usernames of the consumers it holds. */
    consumers(): string[] {
      return [...consumers.keys()];
    },

    /** The consumer's credential keys by credential id, or undefined when there is no such consumer. */
    credentials(username: string): Record<string, string> | undefined {
      const credentials = consumers.get(username);
      return credentials && Object.fromEntries(credentials);
    },

    /** While true, every authenticated call answers 500, as when etcd is down. */
    setFailing(value: boolean): void {
      failing = value;
    },

    /** While false, every connection is dropped, as if APISIX were down. */
    setReachable(value: boolean): void {
      reachable = value;
    },

    reset(): void {
      consumers = new Map();
      failing = false;
      reachable = true;
    },

    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    },
  };
}

export type StubGateway = Awaited<ReturnType<typeof startStubGateway>>;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
