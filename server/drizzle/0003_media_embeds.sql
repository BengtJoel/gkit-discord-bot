CREATE TABLE "embed_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"design" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "embed_messages_guild" ON "embed_messages" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "media_guild" ON "media" USING btree ("guild_id");