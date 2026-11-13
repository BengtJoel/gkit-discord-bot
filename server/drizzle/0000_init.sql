CREATE TABLE "activity_daily" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	"reactions" integer DEFAULT 0 NOT NULL,
	"commands" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_daily_guild_id_user_id_day_pk" PRIMARY KEY("guild_id","user_id","day")
);
--> statement-breakpoint
CREATE TABLE "activity_hourly" (
	"guild_id" text NOT NULL,
	"day" date NOT NULL,
	"hour" integer NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_hourly_guild_id_day_hour_pk" PRIMARY KEY("guild_id","day","hour")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_daily" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_daily_guild_id_channel_id_day_pk" PRIMARY KEY("guild_id","channel_id","day")
);
--> statement-breakpoint
CREATE TABLE "custom_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT 'Custom command' NOT NULL,
	"response" text NOT NULL,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"add_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remove_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"channel_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"icon" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_levels" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"avatar" text,
	"xp" bigint DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_xp_at" timestamp with time zone,
	CONSTRAINT "member_levels_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"avatar" text,
	"bot" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_voice_at" timestamp with time zone,
	CONSTRAINT "members_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mod_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"user_id" text NOT NULL,
	"user_tag" text DEFAULT '' NOT NULL,
	"moderator_id" text NOT NULL,
	"moderator_tag" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_settings" (
	"guild_id" text NOT NULL,
	"module" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "module_settings_guild_id_module_pk" PRIMARY KEY("guild_id","module")
);
--> statement-breakpoint
CREATE TABLE "reaction_role_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#8b5cf6' NOT NULL,
	"mode" text DEFAULT 'normal' NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"avatar" text,
	"access_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temp_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timers" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Stockholm' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "activity_daily_day" ON "activity_daily" USING btree ("guild_id","day");--> statement-breakpoint
CREATE INDEX "audit_guild" ON "audit_log" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_command_name" ON "custom_commands" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "events_guild_time" ON "events" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "events_user" ON "events" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "member_levels_rank" ON "member_levels" USING btree ("guild_id","xp");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_case_number" ON "mod_cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "mod_cases_user" ON "mod_cases" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rr_message" ON "reaction_role_messages" USING btree ("message_id");