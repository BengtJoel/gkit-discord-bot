CREATE TABLE "automation_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text,
	"status" text NOT NULL,
	"reason" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match" text DEFAULT 'all' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_counters" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_counters_guild_id_user_id_key_pk" PRIMARY KEY("guild_id","user_id","key")
);
--> statement-breakpoint
ALTER TABLE "custom_commands" ADD COLUMN "allowed_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_commands" ADD COLUMN "response_mode" text DEFAULT 'channel' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_commands" ADD COLUMN "cooldown_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reaction_role_messages" ADD COLUMN "type" text DEFAULT 'reactions' NOT NULL;--> statement-breakpoint
CREATE INDEX "automation_runs_rule" ON "automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_guild" ON "automation_runs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "automations_guild" ON "automations" USING btree ("guild_id");
--> statement-breakpoint
UPDATE "custom_commands" SET "response_mode" = 'ephemeral' WHERE "ephemeral" = true;
