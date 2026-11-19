import { z } from "zod";
import { offsetPage } from "../common/pagination.js";
import { jobSchema, jobStateSchema } from "../jobs/jobs.js";
import { areaBoxSchema } from "../saved-areas/saved-areas.js";

/** The area limit in km² unless the backend's AGENT_MAX_AREA_KM2 sets another. */
export const defaultAgentMaxAreaKm2 = 5;

export const chatSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Chat = z.infer<typeof chatSchema>;
export const chatPageSchema = offsetPage(chatSchema);
export type ChatPage = z.infer<typeof chatPageSchema>;

const entry = { id: z.uuid(), createdAt: z.iso.datetime() };
export const chatEntrySchema = z.discriminatedUnion("type", [
  z.object({ ...entry, type: z.literal("user"), text: z.string(), area: areaBoxSchema.nullable() }),
  z.object({ ...entry, type: z.literal("assistant"), text: z.string() }),
  z.object({ ...entry, type: z.literal("job"), jobId: z.uuid(), dataset: z.string() }),
  z.object({ ...entry, type: z.literal("job_update"), jobId: z.uuid(), dataset: z.string(), state: jobStateSchema }),
  z.object({ ...entry, type: z.literal("notice"), text: z.string() }),
]);
export type ChatEntry = z.infer<typeof chatEntrySchema>;
export const chatDetailSchema = chatSchema.extend({
  entries: z.array(chatEntrySchema),
  jobs: z.array(jobSchema),
  waitingJobs: z.int().nonnegative(),
  answering: z.boolean(),
  area: areaBoxSchema.nullable(),
});
export type ChatDetail = z.infer<typeof chatDetailSchema>;
export const askBodySchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  area: areaBoxSchema.nullable(),
});
export type AskBody = z.infer<typeof askBodySchema>;
export const updateChatBodySchema = z.strictObject({ title: z.string().trim().min(1).max(120).optional() });
export type UpdateChatBody = z.infer<typeof updateChatBodySchema>;
export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("job"), jobId: z.uuid(), dataset: z.string() }),
  z.object({ type: z.literal("done"), turnId: z.uuid() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
