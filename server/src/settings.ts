import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db/index.js";

const snowflake = z.string().regex(/^\d{15,22}$/, "errors.invalidId");
const optSnowflake = snowflake.nullable().default(null);
const ids = z.array(snowflake).default([]);
const automodAction = z.enum(["delete", "delete_warn", "delete_timeout"]).default("delete");

export const moduleSchemas = {
  general: z.object({
    /** "auto" follows the server's Discord language (Community servers) and falls back to English */
    language: z.enum(["auto", "en", "sv"]).default("auto"),
  }),
  levels: z.object({
    xpMin: z.number().int().min(0).max(1000).default(15),
    xpMax: z.number().int().min(0).max(1000).default(25),
    cooldownSeconds: z.number().int().min(0).max(3600).default(60),
    multiplier: z.number().min(0).max(10).default(1),
    announce: z
      .object({
        mode: z.enum(["current", "channel", "dm", "off"]).default("current"),
        channelId: optSnowflake,
        /** Empty = the localized default (defaults.levelUp) in the server language */
        message: z.string().max(2000).default(""),
      })
      .prefault({}),
    noXpChannelIds: ids,
    noXpRoleIds: ids,
    roleRewards: z.array(z.object({ level: z.number().int().min(1).max(1000), roleId: snowflake })).default([]),
    /** true: keep all earlier reward roles. false: only keep the highest one. */
    stackRewards: z.boolean().default(true),
    /** Remove reward roles again if a member drops below the level (XP removed by an admin) */
    removeOnDemote: z.boolean().default(true),
  }),
  welcome: z.object({
    join: z
      .object({
        enabled: z.boolean().default(true),
        channelId: optSnowflake,
        message: z.string().max(2000).default(""),
      })
      .prefault({}),
    dm: z
      .object({ enabled: z.boolean().default(false), message: z.string().max(2000).default("") })
      .prefault({}),
    leave: z
      .object({
        enabled: z.boolean().default(false),
        channelId: optSnowflake,
        message: z.string().max(2000).default(""),
      })
      .prefault({}),
    autoRoleIds: ids,
  }),
  moderation: z.object({
    logChannelId: optSnowflake,
    /** Members with any of these roles can't be warned, timed out, kicked or banned by the bot */
    immuneRoleIds: ids,
    dmOnAction: z.boolean().default(true),
    /** Automatic escalation when a user reaches N warnings */
    warnThresholds: z
      .array(
        z.object({
          count: z.number().int().min(1).max(100),
          action: z.enum(["timeout", "kick", "ban"]),
          durationMinutes: z.number().int().min(1).max(40320).default(60),
        }),
      )
      .default([]),
  }),
  automod: z.object({
    exemptRoleIds: ids,
    exemptChannelIds: ids,
    timeoutMinutes: z.number().int().min(1).max(40320).default(10),
    badWords: z
      .object({ enabled: z.boolean().default(false), words: z.array(z.string().min(1)).default([]), action: automodAction })
      .prefault({}),
    invites: z.object({ enabled: z.boolean().default(false), action: automodAction }).prefault({}),
    links: z
      .object({ enabled: z.boolean().default(false), allowedDomains: z.array(z.string()).default([]), action: automodAction })
      .prefault({}),
    mentions: z
      .object({ enabled: z.boolean().default(false), max: z.number().int().min(1).max(50).default(5), action: automodAction })
      .prefault({}),
    caps: z
      .object({
        enabled: z.boolean().default(false),
        minLength: z.number().int().min(1).default(10),
        percent: z.number().int().min(1).max(100).default(70),
        action: automodAction,
      })
      .prefault({}),
    spam: z
      .object({
        enabled: z.boolean().default(false),
        messages: z.number().int().min(2).max(50).default(5),
        seconds: z.number().int().min(1).max(120).default(5),
        action: automodAction,
      })
      .prefault({}),
  }),
  tempVoice: z.object({
    hubChannelIds: ids,
    categoryId: optSnowflake,
    nameTemplate: z.string().max(100).default(""),
    userLimit: z.number().int().min(0).max(99).default(0),
  }),
  activity: z.object({
    trackMessages: z.boolean().default(true),
    trackVoice: z.boolean().default(true),
    ignoredChannelIds: ids,
    inactiveDays: z.number().int().min(1).max(365).default(30),
  }),
  /** How the bot looks on this server. Avatar and banner are stored by Discord, not here. */
  branding: z.object({
    nickname: z.string().max(32).nullable().default(null),
    bio: z.string().max(190).default(""),
    /** Accent colour for the bot's embeds (rank, leaderboard, reaction roles…) */
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#8b5cf6"),
  }),
  serverLog: z.object({
    /** One channel per category; null = that category is not logged */
    channels: z
      .object({
        messages: optSnowflake,
        members: optSnowflake,
        roles: optSnowflake,
        voice: optSnowflake,
        channels: optSnowflake,
        server: optSnowflake,
        moderation: optSnowflake,
      })
      .prefault({}),
    ignoredChannelIds: ids,
    ignoreBots: z.boolean().default(true),
  }),
  automations: z.object({}),
  reactionRoles: z.object({}),
  customCommands: z.object({}),
  timers: z.object({}),
} as const;

export type ModuleName = keyof typeof moduleSchemas;
export type ModuleConfig<M extends ModuleName> = z.infer<(typeof moduleSchemas)[M]>;
export const moduleNames = Object.keys(moduleSchemas) as ModuleName[];

/** Modules that are on by default when the bot joins a server */
const defaultEnabled: Partial<Record<ModuleName, boolean>> = { general: true, branding: true, activity: true, moderation: true };

export function isModule(name: string): name is ModuleName {
  return name in moduleSchemas;
}

export interface ModuleState<M extends ModuleName> {
  enabled: boolean;
  config: ModuleConfig<M>;
}

const cache = new Map<string, ModuleState<ModuleName>>();
const key = (g: string, m: string) => `${g}:${m}`;

export function parseConfig<M extends ModuleName>(module: M, raw: unknown): ModuleConfig<M> {
  const result = moduleSchemas[module].safeParse(raw ?? {});
  // Corrupt/outdated config falls back to defaults rather than crashing the bot
  return (result.success ? result.data : moduleSchemas[module].parse({})) as ModuleConfig<M>;
}

export async function getModule<M extends ModuleName>(guildId: string, module: M): Promise<ModuleState<M>> {
  const k = key(guildId, module);
  const hit = cache.get(k);
  if (hit) return hit as ModuleState<M>;
  const [row] = await db
    .select()
    .from(schema.moduleSettings)
    .where(and(eq(schema.moduleSettings.guildId, guildId), eq(schema.moduleSettings.module, module)));
  const state: ModuleState<M> = {
    enabled: row ? row.enabled : (defaultEnabled[module] ?? false),
    config: parseConfig(module, row?.config),
  };
  cache.set(k, state as ModuleState<ModuleName>);
  return state;
}

/** Returns config if the module is enabled, otherwise null. Convenience for event handlers. */
export async function enabledConfig<M extends ModuleName>(guildId: string, module: M): Promise<ModuleConfig<M> | null> {
  const s = await getModule(guildId, module);
  return s.enabled ? s.config : null;
}

export async function saveModule<M extends ModuleName>(
  guildId: string,
  module: M,
  patch: { enabled?: boolean; config?: unknown },
  userId?: string,
): Promise<ModuleState<M>> {
  const current = await getModule(guildId, module);
  const enabled = patch.enabled ?? current.enabled;
  const config =
    patch.config !== undefined
      ? (moduleSchemas[module].parse(patch.config) as ModuleConfig<M>) // throws ZodError -> 400 in API
      : current.config;
  await db
    .insert(schema.moduleSettings)
    .values({ guildId, module, enabled, config, updatedBy: userId ?? null })
    .onConflictDoUpdate({
      target: [schema.moduleSettings.guildId, schema.moduleSettings.module],
      set: { enabled, config, updatedAt: new Date(), updatedBy: userId ?? null },
    });
  const state = { enabled, config };
  cache.set(key(guildId, module), state as ModuleState<ModuleName>);
  return state;
}

export async function getAllModules(guildId: string) {
  const out: Record<string, ModuleState<ModuleName>> = {};
  for (const m of moduleNames) out[m] = await getModule(guildId, m);
  return out;
}

/** The server's brand colour as a number for EmbedBuilder.setColor */
export async function brandColor(guildId: string): Promise<number> {
  const { config } = await getModule(guildId, "branding");
  return parseInt(config.color.slice(1), 16);
}
