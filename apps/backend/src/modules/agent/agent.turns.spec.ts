import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "@repo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelUnavailableError, type ModelReply, type ModelRequest } from "../../infra/model/model.client.js";
import { ScriptedModelClient } from "../../infra/model/scripted.model-client.js";
import type { AgentRepository, AgentMessage, NewAgentMessage, TurnRecord } from "./agent.repository.js";
import type { AgentTools, ToolContext, ToolOutcome } from "./agent.tools.js";
import { AgentTurnRunner } from "./agent.turns.js";
const usage = { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 };
const textReply: ModelReply = { content: [{ type: "text", text: "21 buildings." }], stopReason: "end_turn", usage };
const tool = (id = "tool1"): Anthropic.ToolUseBlockParam => ({ type: "tool_use", id, name: "run_city", input: {} });
const toolReply = (ids = ["tool1"]): ModelReply => ({
  content: ids.map((id) => tool(id)),
  stopReason: "tool_use",
  usage,
});
describe("agent turn runner", () => {
  let messages: AgentMessage[];
  let records: TurnRecord[];
  let events: AgentEvent[];
  let repository: AgentRepository;
  let tools: AgentTools;
  const chat = { id: randomUUID(), userId: randomUUID() };
  const jobId = randomUUID();
  beforeEach(() => {
    messages = [
      {
        id: randomUUID(),
        seq: 1,
        kind: "user",
        content: [{ type: "text", text: "Count buildings" }],
        data: { text: "Count buildings", area: null, bounds: [1, 2, 3, 4] },
        createdAt: "2026-11-07T12:00:00Z",
      },
    ];
    records = [];
    events = [];
    repository = {
      listMessages: vi.fn(() => Promise.resolve(messages)),
      appendMessages: vi.fn((_id: string, additions: NewAgentMessage[]) => {
        messages.push(
          ...additions.map((m) => ({
            ...m,
            id: randomUUID(),
            seq: messages.length + 1,
            createdAt: "2026-11-07T12:00:00Z",
          })),
        );
        return Promise.resolve();
      }),
      insertTurn: vi.fn((record: TurnRecord) => {
        records.push(record);
        return Promise.resolve(randomUUID());
      }),
      countModelCall: vi.fn(() => Promise.resolve()),
      updateTurn: vi.fn((_id: string, record: TurnRecord) => {
        records[0] = record;
        return Promise.resolve();
      }),
    } as unknown as AgentRepository;
    tools = {
      definitions: vi.fn(() =>
        Promise.resolve([{ name: "run_city", input_schema: { type: "object" as const, properties: {} } }]),
      ),
      run: vi.fn((_ctx: ToolContext, use: Anthropic.ToolUseBlockParam): Promise<ToolOutcome> =>
        Promise.resolve({
          block: { type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ buildings: 21 }) },
          call: { toolUseId: use.id, tool: use.name, dataset: "city", jobId },
          reportedJobId: jobId,
        }),
      ),
    } as unknown as AgentTools;
  });
  const opts = () => ({
    signal: new AbortController().signal,
    onEvent: (e: AgentEvent) => {
      events.push(e);
    },
  });
  it("streams and stores an answer with its turn accounting", async () => {
    const runner = new AgentTurnRunner(repository, new ScriptedModelClient([() => textReply]), tools);
    expect((await runner.run(chat, "message", opts())).outcome).toBe("answered");
    expect(events.flatMap((e) => (e.type === "text" ? e.delta : [])).join("")).toBe("21 buildings.");
    expect(messages.at(-1)?.content).toEqual(textReply.content);
    expect(records[0]).toMatchObject({
      ...usage,
      provider: "scripted",
      model: "scripted",
      modelCalls: 1,
      costUsd: "0",
      jobIds: [],
    });
    expect(records[0]?.promptVersion).toMatch(/^[a-f0-9]{12}$/);
  });
  it("returns one complete tool round for every tool use", async () => {
    let second: ModelRequest | undefined;
    const model = new ScriptedModelClient([
      () => toolReply(["tool1", "tool2"]),
      (request) => {
        second = structuredClone(request);
        return textReply;
      },
    ]);
    expect((await new AgentTurnRunner(repository, model, tools).run(chat, "message", opts())).outcome).toBe("answered");
    expect(second?.messages.at(-2)?.content).toEqual(toolReply(["tool1", "tool2"]).content);
    expect(second?.messages.at(-1)?.content).toMatchObject([
      { type: "tool_result", tool_use_id: "tool1" },
      { type: "tool_result", tool_use_id: "tool2" },
    ]);
    expect(records[0]?.jobIds).toEqual([jobId]);
    expect(records[0]?.modelCalls).toBe(2);
  });
  it("stops after six model calls and leaves a notice", async () => {
    const runner = new AgentTurnRunner(
      repository,
      new ScriptedModelClient(Array.from({ length: 6 }, (_, i) => () => toolReply([`tool${String(i)}`]))),
      tools,
    );
    expect((await runner.run(chat, "message", opts())).outcome).toBe("stopped");
    expect(records[0]?.modelCalls).toBe(6);
    expect(messages.at(-1)?.kind).toBe("notice");
  });
  it("drops refused content and never runs its tools", async () => {
    const runner = new AgentTurnRunner(
      repository,
      new ScriptedModelClient([() => ({ ...toolReply(), stopReason: "refusal" })]),
      tools,
    );
    expect((await runner.run(chat, "message", opts())).outcome).toBe("refused");
    expect(tools.run).not.toHaveBeenCalled();
    expect(messages.map((m) => m.kind)).toEqual(["user", "notice"]);
  });
  it("records provider failure with a notice", async () => {
    const runner = new AgentTurnRunner(
      repository,
      new ScriptedModelClient([
        () => {
          throw new ModelUnavailableError("offline");
        },
      ]),
      tools,
    );
    expect((await runner.run(chat, "message", opts())).outcome).toBe("failed");
    expect(messages.at(-1)?.kind).toBe("notice");
  });
  it("counts each model call on the turn before making it", async () => {
    const order: string[] = [];
    vi.mocked(repository.countModelCall).mockImplementation(() => {
      order.push("counted");
      return Promise.resolve();
    });
    const runner = new AgentTurnRunner(
      repository,
      new ScriptedModelClient([
        () => {
          order.push("called");
          return toolReply();
        },
        () => {
          order.push("called");
          throw new ModelUnavailableError("offline");
        },
      ]),
      tools,
    );
    await runner.run(chat, "message", opts());
    expect(order).toEqual(["counted", "called", "counted", "called"]);
  });
  it("records the turn even when storing its failure notice fails", async () => {
    vi.mocked(repository.appendMessages).mockImplementation((_id: string, additions: NewAgentMessage[]) =>
      additions.some((m) => m.kind === "notice")
        ? Promise.reject(new Error("Chat no longer exists"))
        : Promise.resolve(),
    );
    const runner = new AgentTurnRunner(
      repository,
      new ScriptedModelClient([
        () => {
          throw new ModelUnavailableError("offline");
        },
      ]),
      tools,
    );
    await runner.run(chat, "message", opts()).catch(() => undefined);
    expect(records[0]).toMatchObject({ outcome: "failed", modelCalls: 1 });
  });
  it.each(["AbortError", "TimeoutError"])("closes an open tool round on %s", async (name) => {
    const controller = new AbortController();
    vi.mocked(tools.run).mockImplementation(() => {
      controller.abort(new DOMException("stopped", name));
      return Promise.reject(new DOMException("stopped", name));
    });
    const runner = new AgentTurnRunner(repository, new ScriptedModelClient([() => toolReply()]), tools);
    await runner.run(chat, "message", { signal: controller.signal });
    expect(messages.at(-2)?.kind).toBe("tool_results");
    expect(messages.at(-2)?.content).toMatchObject([{ type: "tool_result", tool_use_id: "tool1", is_error: true }]);
    expect(records[0]?.errorCode).toBe(name === "TimeoutError" ? "timed_out" : "client_disconnected");
  });
  it("replays the stored leading history byte-identically", async () => {
    if (!messages[0]) throw new Error("Missing initial message");
    const history: AgentMessage[] = [
      {
        ...messages[0],
        kind: "assistant",
        content: [{ type: "thinking", thinking: "Kept", signature: "signature" }, tool()],
      },
      { ...messages[0], kind: "tool_results", content: [{ type: "tool_result", tool_use_id: "tool1", content: "{}" }] },
      { ...messages[0], kind: "job_update", content: [{ type: "text", text: "<job_update>{}</job_update>" }] },
    ];
    messages.unshift(...history);
    let sent: ModelRequest | undefined;
    const model = new ScriptedModelClient([
      (request) => {
        sent = structuredClone(request);
        return textReply;
      },
    ]);
    await new AgentTurnRunner(repository, model, tools).run(chat, "message", opts());
    expect(JSON.stringify(sent?.messages.slice(0, 3))).toBe(
      JSON.stringify(history.map((m) => ({ role: m.kind === "assistant" ? "assistant" : "user", content: m.content }))),
    );
    expect(history[0]?.content).toEqual(messages[0].content);
  });
  it("records tokens and no cost for a model without rates, and still answers", async () => {
    const model = new ScriptedModelClient([() => textReply]);
    Object.defineProperty(model, "provider", { value: "bedrock" });
    Object.defineProperty(model, "model", { value: "eu.anthropic.claude-sonnet-5-5-v9" });
    expect((await new AgentTurnRunner(repository, model, tools).run(chat, "message", opts())).outcome).toBe("answered");
    expect(records[0]).toMatchObject({ ...usage, provider: "bedrock", costUsd: null, outcome: "answered" });
  });
  it("keeps an answer cut off at the length limit, with its notice", async () => {
    const cut: ModelReply = { content: [{ type: "text", text: "There are 21" }], stopReason: "max_tokens", usage };
    await new AgentTurnRunner(repository, new ScriptedModelClient([() => cut]), tools).run(chat, "message", opts());
    expect(messages.map((m) => m.kind)).toEqual(["user", "assistant", "notice"]);
    expect(messages[1]?.content).toEqual(cut.content);
    expect(events.flatMap((e) => (e.type === "text" ? e.delta : [])).join("")).toBe("There are 21");
    expect(records[0]?.errorCode).toBe("max_tokens");
  });
  it("closes a tool call cut off at the length limit without running it", async () => {
    const cut: ModelReply = { ...toolReply(), stopReason: "max_tokens" };
    await new AgentTurnRunner(repository, new ScriptedModelClient([() => cut]), tools).run(chat, "message", opts());
    expect(tools.run).not.toHaveBeenCalled();
    expect(messages.map((m) => m.kind)).toEqual(["user", "assistant", "tool_results", "notice"]);
    expect(messages[2]?.content).toMatchObject([{ type: "tool_result", tool_use_id: "tool1", is_error: true }]);
  });
  it("strips NUL characters from answer text before storing it", async () => {
    const reply: ModelReply = {
      content: [{ type: "text", text: "21\u0000 buildings." }],
      stopReason: "end_turn",
      usage,
    };
    const runner = new AgentTurnRunner(repository, new ScriptedModelClient([() => reply]), tools);
    expect((await runner.run(chat, "message", opts())).outcome).toBe("answered");
    expect(messages.at(-1)?.content).toEqual([{ type: "text", text: "21 buildings." }]);
  });
  it("fails the turn rather than alter a thinking block that holds a NUL character", async () => {
    const reply: ModelReply = {
      content: [
        { type: "thinking", thinking: "odd\u0000", signature: "signed" },
        { type: "text", text: "21 buildings." },
      ],
      stopReason: "end_turn",
      usage,
    };
    const runner = new AgentTurnRunner(repository, new ScriptedModelClient([() => reply]), tools);
    expect((await runner.run(chat, "message", opts())).outcome).toBe("failed");
    expect(messages.map((m) => m.kind)).toEqual(["user", "notice"]);
    expect(records[0]?.errorCode).toBe("invalid_model_output");
  });
});
it("records the jobs that triggered a background report turn", async () => {
  const chat = { id: randomUUID(), userId: randomUUID() };
  const jobId = randomUUID();
  let recorded: TurnRecord | undefined;
  const repository = {
    insertTurn: vi.fn(() => Promise.resolve(randomUUID())),
    listMessages: vi.fn(() =>
      Promise.resolve([
        {
          id: randomUUID(),
          seq: 1,
          createdAt: "2026-11-07T12:00:00Z",
          kind: "job_update",
          content: [{ type: "text", text: "<job_update>{}</job_update>" }],
          data: { jobs: [{ jobId, dataset: "city", state: "completed" }] },
        },
      ]),
    ),
    appendMessages: vi.fn(() => Promise.resolve()),
    updateTurn: vi.fn((_id: string, record: TurnRecord) => {
      recorded = record;
      return Promise.resolve();
    }),
  } as unknown as AgentRepository;
  const tools = { definitions: vi.fn(() => Promise.resolve([])) } as unknown as AgentTools;
  await new AgentTurnRunner(repository, new ScriptedModelClient([() => textReply]), tools).run(chat, "job_update", {
    signal: new AbortController().signal,
  });
  expect(recorded?.jobIds).toEqual([jobId]);
});
