CREATE TABLE "chat_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"chat_id" uuid NOT NULL,
	"job_id" uuid NOT NULL UNIQUE,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_jobs_chat_id_index" ON "chat_jobs" ("chat_id");--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_chat_id_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;