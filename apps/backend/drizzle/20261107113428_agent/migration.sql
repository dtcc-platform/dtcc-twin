CREATE TABLE "agent_chat_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"chat_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"dataset" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"reported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"turn_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"chat_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_turns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"chat_id" uuid,
	"user_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"outcome" text DEFAULT 'running' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"cost_usd" numeric,
	"model_calls" integer NOT NULL,
	"job_ids" uuid[] NOT NULL,
	"duration_ms" integer NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_chat_jobs_chat_job_unique" ON "agent_chat_jobs" ("chat_id","job_id");--> statement-breakpoint
CREATE INDEX "agent_chat_jobs_job_index" ON "agent_chat_jobs" ("job_id");--> statement-breakpoint
CREATE INDEX "agent_chat_jobs_unreported_index" ON "agent_chat_jobs" ("chat_id") WHERE not "reported";--> statement-breakpoint
CREATE INDEX "agent_chats_user_id_index" ON "agent_chats" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_chat_seq_unique" ON "agent_messages" ("chat_id","seq");--> statement-breakpoint
CREATE INDEX "agent_turns_chat_id_index" ON "agent_turns" ("chat_id");--> statement-breakpoint
CREATE INDEX "agent_turns_user_created_index" ON "agent_turns" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_chat_jobs" ADD CONSTRAINT "agent_chat_jobs_chat_id_agent_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "agent_chats"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_chat_jobs" ADD CONSTRAINT "agent_chat_jobs_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_chats" ADD CONSTRAINT "agent_chats_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_chat_id_agent_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "agent_chats"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_chat_id_agent_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "agent_chats"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;