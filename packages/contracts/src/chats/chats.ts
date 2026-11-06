import { z } from "zod";
import { offsetPage } from "../common/pagination.js";
import { jobSchema, jobStateSchema } from "../jobs/jobs.js";

/** EPSG:3006 bounds in metres, `[minX, minY, maxX, maxY]`: what a Dataset takes as `bounds`. */
export const boundsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).check((context) => {
  // trap: Zod runs this even when an element failed, with its raw value in place.
  if (context.issues.length > 0) return;
  const [minX, minY, maxX, maxY] = context.value;
  if (maxX <= minX) context.issues.push({ code: "custom", input: maxX, path: [2], message: "Must be above minX" });
  if (maxY <= minY) context.issues.push({ code: "custom", input: maxY, path: [3], message: "Must be above minY" });
});
export type Bounds = z.infer<typeof boundsSchema>;

export const chatSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

export const chatPageSchema = offsetPage(chatSummarySchema);
export type ChatPage = z.infer<typeof chatPageSchema>;

const entry = { id: z.string(), createdAt: z.iso.datetime() };

/** One thing the transcript shows, in conversation order. */
export const chatEntrySchema = z.discriminatedUnion("type", [
  z.object({
    ...entry,
    type: z.literal("user"),
    text: z.string(),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  }),
  z.object({ ...entry, type: z.literal("assistant"), text: z.string() }),
  /** A job the assistant started; its state is in the chat's `jobs`. */
  z.object({ ...entry, type: z.literal("job"), jobId: z.uuid(), dataset: z.string() }),
  /** The app telling the assistant how a job it started ended, after the turn that started it. */
  z.object({ ...entry, type: z.literal("job_update"), jobId: z.uuid(), dataset: z.string(), state: jobStateSchema }),
  /** Something that isn't the assistant's answer, such as a turn that failed. */
  z.object({ ...entry, type: z.literal("notice"), text: z.string() }),
]);
export type ChatEntry = z.infer<typeof chatEntrySchema>;

export const chatSchema = chatSummarySchema.extend({
  entries: z.array(chatEntrySchema),
  /** A turn is running: the chat takes no new message until it ends. */
  answering: z.boolean(),
  /** The jobs the assistant started in this chat, in the order it started them. */
  jobs: z.array(jobSchema),
  /** How many of those jobs the assistant hasn't seen finish yet. */
  waitingJobs: z.int().nonnegative(),
});
export type Chat = z.infer<typeof chatSchema>;

// Starts a chat (`POST /chats`) or continues one (`POST /chats/:id/messages`).
export const chatMessageBodySchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  /** The area drawn on the map when the message is sent, or null when there is none. */
  bounds: boundsSchema.nullable(),
});
export type ChatMessageBody = z.infer<typeof chatMessageBodySchema>;
