import {
  pgTable,
  text,
  integer,
  bigint,
  bigserial,
  boolean,
  jsonb,
  timestamp,
  date,
  primaryKey,
  index,
  uniqueIndex,
  serial,
} from "drizzle-orm/pg-core";

/**
 * Discord snowflakes are stored as text (they exceed JS safe integers).
 * Everything is keyed by guild_id so the schema can later move into GuildKit's
 * Supabase as-is (one guild = one tenant).
 */

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  icon: text("icon"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }),
});

/** One row per (guild, module). `config` is validated by the zod schemas in settings.ts. */
export const moduleSettings = pgTable(
  "module_settings",
  {
    guildId: text("guild_id").notNull(),
    module: text("module").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.module] })],
);

/* ---------- Levels ---------- */

export const memberLevels = pgTable(
  "member_levels",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull().default(""),
    avatar: text("avatar"),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    level: integer("level").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    lastXpAt: timestamp("last_xp_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] }), index("member_levels_rank").on(t.guildId, t.xp)],
);

/* ---------- Reaction roles ---------- */

export const reactionRoleMessages = pgTable(
  "reaction_role_messages",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#8b5cf6"),
    /** normal: toggle freely, unique: only one role from this message, verify: add only, never removed */
    mode: text("mode").notNull().default("normal"),
    /** [{ emoji: "🔥" | "<:name:id>", roleId: "…", label?: "…" }] */
    entries: jsonb("entries").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("rr_message").on(t.messageId)],
);

/* ---------- Moderation ---------- */

export const modCases = pgTable(
  "mod_cases",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    caseNumber: integer("case_number").notNull(),
    userId: text("user_id").notNull(),
    userTag: text("user_tag").notNull().default(""),
    moderatorId: text("moderator_id").notNull(),
    moderatorTag: text("moderator_tag").notNull().default(""),
    /** warn | timeout | kick | ban | unban | automod */
    action: text("action").notNull(),
    reason: text("reason").notNull().default(""),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("mod_case_number").on(t.guildId, t.caseNumber), index("mod_cases_user").on(t.guildId, t.userId)],
);

/* ---------- Custom commands ---------- */

export const customCommands = pgTable(
  "custom_commands",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default("Custom command"),
    response: text("response").notNull(),
    ephemeral: boolean("ephemeral").notNull().default(false),
    /** Roles toggled on the user who runs the command */
    addRoleIds: jsonb("add_role_ids").notNull().default([]),
    removeRoleIds: jsonb("remove_role_ids").notNull().default([]),
    /** If non-empty only these roles may run it */
    allowedRoleIds: jsonb("allowed_role_ids").notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    uses: integer("uses").notNull().default(0),
  },
  (t) => [uniqueIndex("custom_command_name").on(t.guildId, t.name)],
);

/* ---------- Timers / scheduled messages ---------- */

export const timers = pgTable("timers", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  name: text("name").notNull().default(""),
  content: text("content").notNull(),
  /** Cron expression (5 fields) evaluated in `timezone` */
  cron: text("cron").notNull(),
  timezone: text("timezone").notNull().default("Europe/Stockholm"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

/* ---------- Temporary voice channels ("create a channel") ---------- */

export const tempChannels = pgTable("temp_channels", {
  channelId: text("channel_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---------- Activity / reports ---------- */

/** Per user per day rollup. Upserted as events happen. */
export const activityDaily = pgTable(
  "activity_daily",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    day: date("day").notNull(),
    messages: integer("messages").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
    reactions: integer("reactions").notNull().default(0),
    commands: integer("commands").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId, t.day] }), index("activity_daily_day").on(t.guildId, t.day)],
);

/** Per channel per day rollup. */
export const channelDaily = pgTable(
  "channel_daily",
  {
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    day: date("day").notNull(),
    messages: integer("messages").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.channelId, t.day] })],
);

/** Guild-wide per hour rollup (Stockholm time) — powers the weekday/hour heatmap. */
export const activityHourly = pgTable(
  "activity_hourly",
  {
    guildId: text("guild_id").notNull(),
    day: date("day").notNull(),
    hour: integer("hour").notNull(),
    messages: integer("messages").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.day, t.hour] })],
);

/** Latest known state of each member — powers "inactive members" and the member list. */
export const members = pgTable(
  "members",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull().default(""),
    displayName: text("display_name").notNull().default(""),
    avatar: text("avatar"),
    bot: boolean("bot").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastVoiceAt: timestamp("last_voice_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

/** Raw event log for joins/leaves/moderation etc. Messages are NOT stored here (only counted). */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id"),
    /** member_join | member_leave | voice_join | voice_leave | level_up | mod_action | automod | role_add | role_remove */
    type: text("type").notNull(),
    channelId: text("channel_id"),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("events_guild_time").on(t.guildId, t.createdAt), index("events_user").on(t.guildId, t.userId)],
);

/* ---------- Dashboard sessions ---------- */

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  accessToken: text("access_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Audit log of dashboard changes */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_guild").on(t.guildId, t.createdAt)],
);
