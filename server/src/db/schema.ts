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
    /** reactions | buttons | select */
    type: text("type").notNull().default("reactions"),
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
    /** If non-empty the command only works in these channels */
    allowedChannelIds: jsonb("allowed_channel_ids").notNull().default([]),
    /** channel | ephemeral | dm  (ephemeral column above is kept for old rows) */
    responseMode: text("response_mode").notNull().default("channel"),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
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

/* ---------- Core: persistent jobs and action log ---------- */

/**
 * Persistent job queue (delayed and retried work): temporary bans, temporary roles,
 * "wait X days" steps in automations. Survives restarts, claimed with FOR UPDATE SKIP LOCKED.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    guildId: text("guild_id"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    /** pending | running | done | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Optional unique key so the same job is only scheduled once (e.g. unban:<guild>:<user>) */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("jobs_due").on(t.status, t.runAt), uniqueIndex("jobs_dedupe").on(t.dedupeKey), index("jobs_guild").on(t.guildId)],
);

/** Every action the bot takes on a member or channel, with the module/rule that caused it. */
export const actionLog = pgTable(
  "action_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    /** e.g. levels, welcome, reactionRoles, moderation, automation:12 */
    source: text("source").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id"),
    ok: boolean("ok").notNull(),
    error: text("error"),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("action_log_guild_time").on(t.guildId, t.createdAt), index("action_log_source").on(t.guildId, t.source)],
);

/* ---------- Automations ---------- */

/**
 * A rule: one trigger, conditions (all/any) and an ordered list of actions.
 * trigger/conditions/actions are validated by the zod schemas in automations/types.ts.
 */
export const automations = pgTable(
  "automations",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default([]),
    /** all | any */
    match: text("match").notNull().default("all"),
    actions: jsonb("actions").notNull().default([]),
    /** Per member: the rule won't run again for the same member within this many seconds */
    cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("automations_guild").on(t.guildId)],
);

/** One row per time a rule was triggered: ran, skipped (and why) or failed */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    automationId: integer("automation_id").notNull(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id"),
    /** ok | skipped | failed | partial */
    status: text("status").notNull(),
    reason: text("reason"),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("automation_runs_rule").on(t.automationId, t.createdAt), index("automation_runs_guild").on(t.guildId, t.createdAt)],
);

/** Per-member counters automations can increment and test (e.g. "verified attempts") */
export const memberCounters = pgTable(
  "member_counters",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId, t.key] })],
);
