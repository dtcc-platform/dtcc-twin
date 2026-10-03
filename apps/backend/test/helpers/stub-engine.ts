import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A DTCC Engine job state, as the engine reports it. */
export type StubJobState = "unconfirmed" | "queued" | "running" | "completed" | "failed";

/** The body of the engine's `GET /api/v1/jobs/{id}`, as apps/engine/dtcc_engine/jobs.py builds it. */
export type StubJobStatus = {
  job_id: string;
  dataset: string;
  target: string;
  submitted_at: string;
  finished_at: string | null;
  state: StubJobState;
  progress: Record<string, unknown> | null;
  error: { type: string } | null;
  package: { available: boolean; expires_at: string } | null;
};

export type StubDescriptor = Record<string, unknown> & { name: string };

export type StubSubmission = { body: unknown; jobId: string | null };

type StubJob = { status: StubJobStatus; packageBytes: Uint8Array | null };
type SubmitResponse = { status: number; detail: unknown };

const retentionMs = 30 * 24 * 60 * 60 * 1000;

/**
 * A Dataset descriptor shaped like Core's `describe()`, including fields the backend ignores, so tests can show
 * they're dropped. `stub.setDatasets([descriptor("smoke")])`
 */
export function descriptor(name: string, overrides: Record<string, unknown> = {}): StubDescriptor {
  return {
    name,
    title: `Title of ${name}`,
    description: `Description of ${name}`,
    data_category: "derived",
    result_kind: "mesh",
    python_return_type: "dtcc_core.model.Mesh",
    args_schema: { type: "object", properties: { bounds: { type: "array" } }, required: ["bounds"] },
    supported_formats: [],
    formats: {},
    multi_file_formats: [],
    timeout_hint: null,
    serialization: {
      python_object_when_format_omitted: true,
      bytes_when_format_is_set: false,
      format_parameter: false,
    },
    ...overrides,
  };
}

/**
 * Starts a fake DTCC Engine on a random local port, answering its routes with its response shapes. Tests set what it
 * returns; call `reset()` before each test and `close()` after the file. Like the engine, it answers 401 without the
 * right bearer token.
 */
export async function startStubEngine(token = "stub-engine-token") {
  let datasets: StubDescriptor[] = [];
  let jobs = new Map<string, StubJob>();
  let nextSubmit: SubmitResponse | "unconfirmed" | null = null;
  let reachable = true;
  const submissions: StubSubmission[] = [];

  const server = createServer((request, response) => {
    if (!reachable) {
      request.socket.destroy();
      return;
    }
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://stub").pathname;
    if (request.headers.authorization !== `Bearer ${token}`) {
      send(response, 401, { detail: "Missing or invalid Engine API token" });
      return;
    }

    const datasetMatch = /^\/api\/v1\/datasets\/([^/]+)$/.exec(path);
    const jobMatch = /^\/api\/v1\/jobs\/([^/]+)$/.exec(path);
    const packageMatch = /^\/api\/v1\/jobs\/([^/]+)\/package$/.exec(path);

    if (request.method === "GET" && path === "/api/v1/datasets") {
      send(response, 200, {
        catalog_revision: "sha256:stub",
        versions: { "dtcc-engine": "0.1.0", "dtcc-core": "0.1.0", "dtcc-sim": "0.1.0" },
        datasets: Object.fromEntries(datasets.map((dataset) => [dataset.name, dataset])),
      });
    } else if (request.method === "GET" && datasetMatch) {
      const name = decodeURIComponent(datasetMatch[1] ?? "");
      const dataset = datasets.find((candidate) => candidate.name === name);
      if (dataset) send(response, 200, dataset);
      else send(response, 404, { detail: `Dataset '${name}' is not registered` });
    } else if (request.method === "POST" && path === "/api/v1/jobs") {
      submit(await readJson(request), response);
    } else if (request.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1] ?? "");
      if (job) send(response, 200, job.status);
      else send(response, 404, { detail: `Job '${jobMatch[1] ?? ""}' is unknown or expired` });
    } else if (request.method === "GET" && packageMatch) {
      const job = jobs.get(packageMatch[1] ?? "");
      if (!job) send(response, 404, { detail: `Job '${packageMatch[1] ?? ""}' is unknown or expired` });
      else if (!job.packageBytes)
        send(response, 409, { detail: `Job has no package; its state is '${job.status.state}'` });
      else {
        response.writeHead(200, { "content-type": "application/zip" });
        response.end(job.packageBytes);
      }
    } else {
      send(response, 404, { detail: "Not Found" });
    }
  }

  function submit(body: unknown, response: ServerResponse): void {
    const planned = nextSubmit;
    nextSubmit = null;
    if (planned !== null && planned !== "unconfirmed") {
      submissions.push({ body, jobId: null });
      send(response, planned.status, { detail: planned.detail });
      return;
    }

    const jobId = randomUUID();
    const dataset = (body as { dataset?: unknown }).dataset;
    jobs.set(jobId, {
      status: {
        job_id: jobId,
        dataset: typeof dataset === "string" ? dataset : "",
        target: "local",
        submitted_at: new Date().toISOString(),
        finished_at: null,
        state: planned === "unconfirmed" ? "unconfirmed" : "queued",
        progress: null,
        error: null,
        package: null,
      },
      packageBytes: null,
    });
    submissions.push({ body, jobId });
    const statusUrl = `/api/v1/jobs/${jobId}`;
    if (planned === "unconfirmed") {
      send(response, 503, {
        detail: {
          message: "The queue did not confirm the job, which may still run; poll it before resubmitting",
          job_id: jobId,
          status_url: statusUrl,
        },
      });
    } else {
      send(response, 202, { job_id: jobId, status_url: statusUrl });
    }
  }

  function update(jobId: string, changes: Partial<StubJobStatus>, packageBytes: Uint8Array | null = null): void {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`The stub engine has no job ${jobId}`);
    jobs.set(jobId, { status: { ...job.status, ...changes }, packageBytes });
  }

  function finished(): { finishedAt: string; expiresAt: string } {
    const now = Date.now();
    return { finishedAt: new Date(now).toISOString(), expiresAt: new Date(now + retentionMs).toISOString() };
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    token,
    /** Every `POST /api/v1/jobs` body, in order, with the job id it created or null when it was rejected. */
    submissions,

    setDatasets(descriptors: StubDescriptor[]): void {
      datasets = descriptors;
    },

    /** The next submit answers `status` with `{ detail }` and creates no job, as a 422 or a down queue does. */
    rejectNextSubmit(status: number, detail: unknown): void {
      nextSubmit = { status, detail };
    },

    /** The next submit creates an `unconfirmed` job and answers 503 with its id: the job may still run. */
    unconfirmNextSubmit(): void {
      nextSubmit = "unconfirmed";
    },

    /** Moves a job to an unfinished state; `progress` is Core's progress dictionary. */
    setJob(
      jobId: string,
      state: "unconfirmed" | "queued" | "running",
      progress: Record<string, unknown> | null = null,
    ): void {
      update(jobId, { state, progress, finished_at: null, error: null, package: null });
    },

    /**
     * Completes a job. `available: false` reports its package as missing, as the engine does when the file is gone;
     * `served: false` reports it available but answers its download with 409, as when the file goes in between.
     */
    completeJob(
      jobId: string,
      packageBytes: Uint8Array,
      { available = true, served = available }: { available?: boolean; served?: boolean } = {},
    ): void {
      const { finishedAt, expiresAt } = finished();
      update(
        jobId,
        {
          state: "completed",
          progress: null,
          finished_at: finishedAt,
          error: null,
          package: { available, expires_at: expiresAt },
        },
        served ? packageBytes : null,
      );
    },

    failJob(jobId: string, errorType: string): void {
      update(jobId, {
        state: "failed",
        progress: null,
        finished_at: finished().finishedAt,
        error: { type: errorType },
        package: null,
      });
    },

    /** The engine no longer knows the job, as after its retention: status and package answer 404. */
    forgetJob(jobId: string): void {
      jobs.delete(jobId);
    },

    /** While false, every connection is dropped, as if the engine were down. */
    setReachable(value: boolean): void {
      reachable = value;
    },

    reset(): void {
      datasets = [];
      jobs = new Map();
      nextSubmit = null;
      reachable = true;
      submissions.length = 0;
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

export type StubEngine = Awaited<ReturnType<typeof startStubEngine>>;

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
