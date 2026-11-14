import { z } from "zod";

/**
 * Automation rules: WHEN <trigger> IF <conditions> THEN <actions>.
 * Everything is JSON so the dashboard can build it and the API can validate it.
 */

const snowflake = z.string().regex(/^\d{15,22}$/, "errors.invalidId");
const ids = z.array(snowflake).max(25).default([]);
/** Keys tie buttons/menus sent by one rule to the rule that reacts to them */
const key = z.string().regex(/^[a-z0-9_-]{1,40}$/i, "errors.automationKey");
const op = z.enum(["gte", "lte", "eq"]);
const text = (max = 2000) => z.string().max(max);

/* ---------------- Triggers ---------------- */

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_sent"), channelIds: ids }),
  z.object({ type: z.literal("member_joined") }),
  z.object({ type: z.literal("member_left") }),
  z.object({ type: z.literal("role_added"), roleIds: ids }),
  z.object({ type: z.literal("role_removed"), roleIds: ids }),
  z.object({
    type: z.literal("reaction_added"),
    messageId: snowflake.nullable().default(null),
    emoji: z.string().max(100).default(""),
  }),
  z.object({
    type: z.literal("reaction_removed"),
    messageId: snowflake.nullable().default(null),
    emoji: z.string().max(100).default(""),
  }),
  z.object({ type: z.literal("button_clicked"), key }),
  z.object({ type: z.literal("select_chosen"), key }),
  z.object({ type: z.literal("level_reached"), level: z.number().int().min(1).max(1000).nullable().default(null) }),
  z.object({ type: z.literal("voice_joined"), channelIds: ids }),
  z.object({ type: z.literal("voice_left"), channelIds: ids }),
  z.object({ type: z.literal("command_used"), command: z.string().regex(/^[a-z0-9_-]{1,32}$/) }),
  z.object({ type: z.literal("schedule"), cron: z.string().min(9).max(100), timezone: z.string().default("Europe/Stockholm") }),
  z.object({ type: z.literal("inactive"), days: z.number().int().min(1).max(365).default(30) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerType = Trigger["type"];

/** Triggers that happen without a specific member (actions on "the member" are skipped) */
export const memberlessTriggers: TriggerType[] = ["schedule", "member_left"];

/* ---------------- Conditions ---------------- */

export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("has_role"), roleIds: ids, mode: z.enum(["any", "all"]).default("any") }),
  z.object({ type: z.literal("lacks_role"), roleIds: ids }),
  z.object({ type: z.literal("in_channel"), channelIds: ids }),
  z.object({
    type: z.literal("message_contains"),
    words: z.array(z.string().min(1).max(100)).max(50).default([]),
    mode: z.enum(["any", "all"]).default("any"),
    wholeWord: z.boolean().default(true),
  }),
  z.object({ type: z.literal("message_regex"), pattern: z.string().min(1).max(200) }),
  z.object({ type: z.literal("level"), op, value: z.number().int().min(0).max(1000) }),
  z.object({ type: z.literal("member_days"), op, value: z.number().int().min(0).max(10000) }),
  z.object({ type: z.literal("account_days"), op, value: z.number().int().min(0).max(10000) }),
  z.object({ type: z.literal("counter"), key, op, value: z.number().int() }),
  z.object({ type: z.literal("selected"), values: z.array(z.string().max(100)).min(1).max(25) }),
  z.object({ type: z.literal("chance"), percent: z.number().min(0).max(100) }),
]);
export type Condition = z.infer<typeof conditionSchema>;

/* ---------------- Actions ---------------- */

const buttonSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  style: z.enum(["primary", "secondary", "success", "danger"]).default("primary"),
  emoji: z.string().max(100).default(""),
});
const selectSchema = z.object({
  key,
  placeholder: z.string().max(150).default(""),
  min: z.number().int().min(0).max(25).default(1),
  max: z.number().int().min(1).max(25).default(1),
  options: z
    .array(z.object({ label: z.string().min(1).max(100), value: z.string().min(1).max(100), emoji: z.string().max(100).default(""), description: z.string().max(100).default("") }))
    .min(1)
    .max(25),
});
const embedSchema = z.object({
  title: text(256).default(""),
  description: text(4000).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .default(null),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_message"),
    /** null = the channel where the trigger happened */
    channelId: snowflake.nullable().default(null),
    content: text().default(""),
    embed: embedSchema.nullable().default(null),
    buttons: z.array(buttonSchema).max(5).default([]),
    select: selectSchema.nullable().default(null),
  }),
  z.object({ type: z.literal("reply"), content: text().min(1), private: z.boolean().default(true) }),
  z.object({ type: z.literal("send_dm"), content: text().min(1) }),
  z.object({ type: z.literal("add_roles"), roleIds: ids }),
  z.object({ type: z.literal("remove_roles"), roleIds: ids }),
  z.object({ type: z.literal("toggle_roles"), roleIds: ids }),
  z.object({ type: z.literal("temp_role"), roleIds: ids, minutes: z.number().int().min(1).max(60 * 24 * 90) }),
  /** The roles picked in a select menu are given; the menu's other options' roles are removed */
  z.object({ type: z.literal("roles_from_select"), mapping: z.array(z.object({ value: z.string(), roleId: snowflake })).max(25) }),
  z.object({ type: z.literal("delete_message") }),
  z.object({ type: z.literal("add_reaction"), emoji: z.string().min(1).max(100) }),
  z.object({ type: z.literal("timeout"), minutes: z.number().int().min(1).max(40320), reason: text(300).default("") }),
  z.object({ type: z.literal("warn"), reason: text(300).default("") }),
  z.object({ type: z.literal("give_xp"), amount: z.number().int().min(-100000).max(100000) }),
  z.object({ type: z.literal("set_nickname"), template: text(32) }),
  z.object({ type: z.literal("wait"), minutes: z.number().int().min(1).max(60 * 24 * 30) }),
  z.object({ type: z.literal("counter"), key, op: z.enum(["inc", "dec", "set"]), value: z.number().int().default(1) }),
  z.object({ type: z.literal("log"), channelId: snowflake, content: text().min(1) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const ruleSchema = z.object({
  name: z.string().max(100).default(""),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(20).default([]),
  match: z.enum(["all", "any"]).default("all"),
  actions: z.array(actionSchema).min(1).max(20),
  cooldownSeconds: z.number().int().min(0).max(30 * 86400).default(0),
});
export type RuleInput = z.infer<typeof ruleSchema>;

export interface Rule extends RuleInput {
  id: number;
  guildId: string;
}

/** Safety limits per run (one trigger -> one rule) */
export const LIMITS = {
  actionsPerRun: 20,
  roleChangesPerRun: 10,
  messagesPerRun: 5,
  dmsPerRun: 3,
  /** A rule triggered by another rule's role change etc. — stop chains deeper than this */
  maxDepth: 3,
  /** Rule runs per guild per minute */
  runsPerGuildPerMinute: 120,
};
