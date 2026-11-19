import type Anthropic from "@anthropic-ai/sdk";
import type { AreaBox, ChatEntry } from "@repo/contracts";
import type { AgentMessage, NewAgentMessage } from "./agent.repository.js";
import type { SwerefBounds } from "./area.js";
import type { JobReport, ToolOutcome } from "./agent.tools.js";

export function userMessage(text: string, area: AreaBox | null, bounds: SwerefBounds | null): NewAgentMessage {
  const context = bounds
    ? `Selected area: EPSG:3006 bounds [${bounds.join(", ")}], ${(((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / 1_000_000).toFixed(2)} km².`
    : "No area is drawn on the map.";
  return {
    kind: "user",
    content: [
      { type: "text", text: `<map_context>${context}</map_context>` },
      { type: "text", text },
    ],
    data: { text, area, bounds },
  };
}
export function assistantMessage(content: Anthropic.ContentBlockParam[]): NewAgentMessage {
  return { kind: "assistant", content, data: null };
}
export function toolResults(outcomes: ToolOutcome[]): NewAgentMessage {
  return { kind: "tool_results", content: outcomes.map((o) => o.block), data: { calls: outcomes.map((o) => o.call) } };
}
export function jobUpdate(reports: JobReport[]): NewAgentMessage {
  return {
    kind: "job_update",
    content: reports.map((report) => ({ type: "text", text: `<job_update>${JSON.stringify(report)}</job_update>` })),
    data: { jobs: reports.map((report) => ({ jobId: report.job_id, dataset: report.dataset, state: report.state })) },
  };
}
export function notice(text: string): NewAgentMessage {
  return { kind: "notice", content: null, data: { text } };
}
export function toModelMessages(stored: AgentMessage[]): Anthropic.MessageParam[] {
  return stored
    .filter((m) => m.kind !== "notice")
    .map((m) => ({
      role: m.kind === "assistant" ? "assistant" : "user",
      content: m.content as Anthropic.MessageParam["content"],
    }));
}
export function toEntries(stored: AgentMessage[]): ChatEntry[] {
  return stored.flatMap((message): ChatEntry[] => {
    const base = { id: message.id, createdAt: message.createdAt };
    switch (message.kind) {
      case "user": {
        const data = message.data as { text: string; area: AreaBox | null };
        return [{ ...base, type: "user", text: data.text, area: data.area }];
      }
      case "assistant": {
        const text = (message.content as Anthropic.ContentBlockParam[])
          .flatMap((b) => (b.type === "text" ? b.text : []))
          .join("");
        return text ? [{ ...base, type: "assistant", text }] : [];
      }
      case "tool_results": {
        const data = message.data as { calls: ToolOutcome["call"][] };
        return data.calls.flatMap((call) =>
          call.jobId && call.dataset
            ? [{ ...base, type: "job" as const, jobId: call.jobId, dataset: call.dataset }]
            : [],
        );
      }
      case "job_update":
        return (message.data as { jobs: { jobId: string; dataset: string; state: JobReport["state"] }[] }).jobs.map(
          (job) => ({ ...base, type: "job_update" as const, ...job }),
        );
      case "notice":
        return [{ ...base, type: "notice", text: (message.data as { text: string }).text }];
    }
  });
}
/** Answers each tool call with an error result, for a turn that ends before its tools do. */
export function closingResults(uses: Anthropic.ToolUseBlockParam[], text: string): NewAgentMessage {
  return toolResults(
    uses.map((use) => ({
      block: { type: "tool_result", tool_use_id: use.id, content: text, is_error: true },
      call: { toolUseId: use.id, tool: use.name, dataset: null, jobId: null },
      reportedJobId: null,
    })),
  );
}
/** Closes the tool calls of a turn whose process ended before their results were stored, so the history stays valid. */
export function closeInterrupted(stored: AgentMessage[]): NewAgentMessage[] {
  const last = stored.findLast((message) => message.kind !== "notice");
  if (last?.kind !== "assistant") return [];
  const uses = (last.content as Anthropic.ContentBlockParam[]).filter(
    (block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use",
  );
  if (!uses.length) return [];
  return [
    closingResults(uses, "The previous turn was interrupted before this tool finished."),
    notice("The previous answer was interrupted. Any job it started will be reported here."),
  ];
}
/**
 * Model content Postgres can store: NUL removed from text blocks. Null when another block holds one,
 * since thinking and tool calls must be replayed unchanged.
 */
export function storable(content: Anthropic.ContentBlockParam[]): Anthropic.ContentBlockParam[] | null {
  if (content.some((block) => block.type !== "text" && holdsNul(block))) return null;
  return content.map((block) =>
    block.type === "text" ? { ...block, text: block.text.replaceAll("\u0000", "") } : block,
  );
}
function holdsNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  return typeof value === "object" && value !== null && Object.values(value).some(holdsNul);
}
