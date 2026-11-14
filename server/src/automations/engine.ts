import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type MessageCreateOptions,
  type StringSelectMenuInteraction,
} from "discord.js";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { log } from "../lib/log.js";
import { renderTemplate } from "../lib/template.js";
import { brandColor, getModule } from "../settings.js";
import { addRoles, removeRoles, sendDm, sendToChannel, timeoutMember } from "../core/actions.js";
import { scheduleJob } from "../core/jobs.js";
import { LIMITS, ruleSchema, type Action, type Condition, type Rule, type Trigger, type TriggerType } from "./types.js";

/* ============================================================
 * Context: everything we know about the event that fired
 * ============================================================ */

export interface TriggerContext {
  guild: Guild;
  member?: GuildMember | null;
  userId?: string | null;
  channelId?: string | null;
  message?: Message | null;
  interaction?: ButtonInteraction | StringSelectMenuInteraction | null;
  roleId?: string | null;
  level?: number | null;
  emoji?: string | null;
  messageId?: string | null;
  values?: string[];
  command?: string | null;
  /** How many automation steps led to this event (loop guard) */
  depth?: number;
}

/** Things conditions need that come from the database; injectable for tests */
export interface Facts {
  level(guildId: string, userId: string): Promise<number>;
  counter(guildId: string, userId: string, key: string): Promise<number>;
}

/* ============================================================
 * Rule cache
 * ============================================================ */

const cache = new Map<string, Rule[]>();

export function rowToRule(row: typeof schema.automations.$inferSelect): Rule | null {
  const parsed = ruleSchema.safeParse({
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    conditions: row.conditions,
    match: row.match,
    actions: row.actions,
    cooldownSeconds: row.cooldownSeconds,
  });
  if (!parsed.success) {
    log.warn({ rule: row.id, issues: parsed.error.issues }, "automation has invalid config, ignoring");
    return null;
  }
  return { ...parsed.data, id: row.id, guildId: row.guildId };
}

export async function rulesFor(guildId: string): Promise<Rule[]> {
  const hit = cache.get(guildId);
  if (hit) return hit;
  const rows = await db.select().from(schema.automations).where(eq(schema.automations.guildId, guildId));
  const rules = rows.map(rowToRule).filter((r): r is Rule => !!r);
  cache.set(guildId, rules);
  return rules;
}

export function invalidateRules(guildId: string) {
  cache.delete(guildId);
}

/* ============================================================
 * Guards: loop depth, cooldowns, guild rate
 * ============================================================ */

/** When a rule changes a role, the resulting role event inherits depth+1 */
const causes = new Map<string, { depth: number; until: number }>();
export function markCause(guildId: string, userId: string, roleId: string, kind: "added" | "removed", depth: number) {
  causes.set(`${guildId}:${userId}:${roleId}:${kind}`, { depth, until: Date.now() + 15_000 });
}
export function takeCause(guildId: string, userId: string, roleId: string, kind: "added" | "removed") {
  const k = `${guildId}:${userId}:${roleId}:${kind}`;
  const c = causes.get(k);
  causes.delete(k);
  return c && c.until > Date.now() ? c.depth : 0;
}

const cooldowns = new Map<string, number>();
const guildRuns = new Map<string, { windowStart: number; count: number }>();

function rateOk(guildId: string) {
  const now = Date.now();
  const w = guildRuns.get(guildId);
  if (!w || now - w.windowStart > 60_000) {
    guildRuns.set(guildId, { windowStart: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= LIMITS.runsPerGuildPerMinute;
}

/* ============================================================
 * Matching
 * ============================================================ */

/** Unicode emoji or custom emoji "<:name:id>" / id -> comparable key */
export function emojiKey(e: string) {
  const m = e.match(/<a?:\w+:(\d+)>/) ?? e.match(/^(\d{15,22})$/);
  return m ? m[1] : e.trim();
}

export function triggerMatches(trigger: Trigger, type: TriggerType, ctx: Pick<TriggerContext, "channelId" | "roleId" | "level" | "emoji" | "messageId" | "command"> & { key?: string | null; parentId?: string | null }) {
  if (trigger.type !== type) return false;
  const inChannels = (ids: string[]) => !ids.length || ids.includes(ctx.channelId ?? "") || ids.includes(ctx.parentId ?? "");
  switch (trigger.type) {
    case "message_sent":
    case "voice_joined":
    case "voice_left":
      return inChannels(trigger.channelIds);
    case "role_added":
    case "role_removed":
      return !trigger.roleIds.length || trigger.roleIds.includes(ctx.roleId ?? "");
    case "reaction_added":
    case "reaction_removed":
      return (!trigger.messageId || trigger.messageId === ctx.messageId) && (!trigger.emoji || emojiKey(trigger.emoji) === emojiKey(ctx.emoji ?? ""));
    case "button_clicked":
    case "select_chosen":
      return trigger.key.toLowerCase() === (ctx.key ?? "").toLowerCase();
    case "level_reached":
      return trigger.level === null || trigger.level === ctx.level;
    case "command_used":
      return trigger.command === ctx.command;
    default:
      return true;
  }
}

/* ============================================================
 * Conditions
 * ============================================================ */

const compare = (op: "gte" | "lte" | "eq", a: number, b: number) => (op === "gte" ? a >= b : op === "lte" ? a <= b : a === b);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const days = (from: number | null | undefined) => (from ? Math.floor((Date.now() - from) / 86400_000) : 0);

export async function evaluateCondition(c: Condition, ctx: TriggerContext, facts: Facts): Promise<boolean> {
  const member = ctx.member;
  const userId = ctx.userId ?? member?.id ?? null;
  const content = ctx.message?.content ?? "";
  switch (c.type) {
    case "has_role": {
      if (!member) return false;
      const has = (id: string) => member.roles.cache.has(id);
      return c.mode === "all" ? c.roleIds.every(has) : c.roleIds.some(has);
    }
    case "lacks_role":
      return !!member && !c.roleIds.some((id) => member.roles.cache.has(id));
    case "in_channel": {
      const ch = ctx.channelId ? ctx.guild.channels.cache.get(ctx.channelId) : null;
      const parent = ch && "parentId" in ch ? ch.parentId : null;
      return c.channelIds.includes(ctx.channelId ?? "") || (!!parent && c.channelIds.includes(parent));
    }
    case "message_contains": {
      const lower = content.toLowerCase();
      const hit = (w: string) =>
        c.wholeWord ? new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w.toLowerCase())}($|[^\\p{L}\\p{N}])`, "u").test(lower) : lower.includes(w.toLowerCase());
      return c.mode === "all" ? c.words.every(hit) : c.words.some(hit);
    }
    case "message_regex":
      try {
        return new RegExp(c.pattern, "i").test(content);
      } catch {
        return false;
      }
    case "level":
      return !!userId && compare(c.op, ctx.level ?? (await facts.level(ctx.guild.id, userId)), c.value);
    case "member_days":
      return !!member?.joinedTimestamp && compare(c.op, days(member.joinedTimestamp), c.value);
    case "account_days": {
      const created = member?.user.createdTimestamp ?? null;
      return !!created && compare(c.op, days(created), c.value);
    }
    case "counter":
      return !!userId && compare(c.op, await facts.counter(ctx.guild.id, userId, c.key), c.value);
    case "selected":
      return (ctx.values ?? []).some((v) => c.values.includes(v));
    case "chance":
      return Math.random() * 100 < c.percent;
  }
}

export async function evaluateConditions(rule: Pick<Rule, "conditions" | "match">, ctx: TriggerContext, facts: Facts) {
  const results: { type: Condition["type"]; pass: boolean }[] = [];
  for (const c of rule.conditions) results.push({ type: c.type, pass: await evaluateCondition(c, ctx, facts) });
  const pass = !results.length || (rule.match === "any" ? results.some((r) => r.pass) : results.every((r) => r.pass));
  return { pass, results };
}

export const dbFacts: Facts = {
  async level(guildId, userId) {
    const [row] = await db
      .select({ level: schema.memberLevels.level })
      .from(schema.memberLevels)
      .where(and(eq(schema.memberLevels.guildId, guildId), eq(schema.memberLevels.userId, userId)));
    return row?.level ?? 0;
  },
  async counter(guildId, userId, key) {
    const t = schema.memberCounters;
    const [row] = await db.select({ value: t.value }).from(t).where(and(eq(t.guildId, guildId), eq(t.userId, userId), eq(t.key, key)));
    return row?.value ?? 0;
  },
};

/* ============================================================
 * Text
 * ============================================================ */

export async function renderText(text: string, ctx: TriggerContext, facts: Facts = dbFacts) {
  const userId = ctx.userId ?? ctx.member?.id ?? null;
  let out = text;
  // {counter:key}
  for (const m of [...text.matchAll(/\{counter:([a-z0-9_-]+)\}/gi)]) {
    const v = userId ? await facts.counter(ctx.guild.id, userId, m[1]) : 0;
    out = out.replace(m[0], String(v));
  }
  const role = ctx.roleId ? ctx.guild.roles.cache.get(ctx.roleId) : null;
  return renderTemplate(out, {
    member: ctx.member ?? null,
    guild: ctx.guild,
    extra: {
      channel: ctx.channelId ? `<#${ctx.channelId}>` : "",
      role: role?.name ?? "",
      level: ctx.level ?? "",
      selected: (ctx.values ?? []).join(", "),
      ...(userId && !ctx.member ? { user: `<@${userId}>`, userid: userId } : {}),
    },
  });
}

/* ============================================================
 * Actions
 * ============================================================ */

const buttonStyles = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

export const componentId = {
  button: (key: string) => `gk:a:${key}`,
  select: (key: string) => `gk:s:${key}`,
};

export async function buildMessage(a: Extract<Action, { type: "send_message" }>, ctx: TriggerContext): Promise<MessageCreateOptions> {
  const payload: MessageCreateOptions = { allowedMentions: { parse: ["users", "roles"] } };
  if (a.content) payload.content = await renderText(a.content, ctx);
  if (a.embed && (a.embed.title || a.embed.description)) {
    const e = new EmbedBuilder().setColor(a.embed.color ? parseInt(a.embed.color.slice(1), 16) : await brandColor(ctx.guild.id));
    if (a.embed.title) e.setTitle(await renderText(a.embed.title, ctx));
    if (a.embed.description) e.setDescription(await renderText(a.embed.description, ctx));
    payload.embeds = [e];
  }
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (a.buttons.length) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const b of a.buttons) {
      const btn = new ButtonBuilder().setCustomId(componentId.button(b.key)).setLabel(b.label).setStyle(buttonStyles[b.style]);
      if (b.emoji) btn.setEmoji(b.emoji);
      row.addComponents(btn);
    }
    rows.push(row);
  }
  if (a.select) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(componentId.select(a.select.key))
      .setMinValues(Math.min(a.select.min, a.select.options.length))
      .setMaxValues(Math.min(Math.max(a.select.max, a.select.min, 1), a.select.options.length))
      .addOptions(
        a.select.options.map((o) => ({ label: o.label, value: o.value, ...(o.description ? { description: o.description } : {}), ...(o.emoji ? { emoji: o.emoji } : {}) })),
      );
    if (a.select.placeholder) menu.setPlaceholder(a.select.placeholder);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  if (rows.length) payload.components = rows;
  if (!payload.content && !payload.embeds && !payload.components) payload.content = "​";
  return payload;
}

export interface ActionOutcome {
  type: Action["type"];
  ok: boolean;
  skipped?: string;
  error?: string;
}

interface RunState {
  roleChanges: number;
  messages: number;
  dms: number;
  replied: boolean;
}

const ROLE_TYPES = new Set<Action["type"]>(["add_roles", "remove_roles", "toggle_roles", "temp_role", "roles_from_select"]);
const MEMBER_TYPES = new Set<Action["type"]>([...ROLE_TYPES, "send_dm", "timeout", "warn", "give_xp", "set_nickname", "counter"]);

async function runAction(a: Action, rule: Rule, ctx: TriggerContext, state: RunState): Promise<ActionOutcome> {
  const src = { source: `automation:${rule.id}`, reason: rule.name || `Automation #${rule.id}` };
  const member = ctx.member;
  const depth = (ctx.depth ?? 0) + 1;
  if (MEMBER_TYPES.has(a.type) && !member) return { type: a.type, ok: false, skipped: "noMember" };
  if (ROLE_TYPES.has(a.type) && state.roleChanges >= LIMITS.roleChangesPerRun) return { type: a.type, ok: false, skipped: "limit" };

  const changeRoles = async (kind: "add" | "remove", roleIds: string[]) => {
    const wanted = roleIds.filter((id) => (kind === "add" ? !member!.roles.cache.has(id) : member!.roles.cache.has(id)));
    if (!wanted.length) return { ok: true } as const;
    for (const id of wanted) markCause(ctx.guild.id, member!.id, id, kind === "add" ? "added" : "removed", depth);
    state.roleChanges += wanted.length;
    return kind === "add" ? addRoles(member!, wanted, src) : removeRoles(member!, wanted, src);
  };
  const result = (r: { ok: boolean; code?: string }): ActionOutcome => ({ type: a.type, ok: r.ok, error: r.ok ? undefined : r.code });

  switch (a.type) {
    case "send_message": {
      if (state.messages >= LIMITS.messagesPerRun) return { type: a.type, ok: false, skipped: "limit" };
      const channelId = a.channelId ?? ctx.channelId;
      if (!channelId) return { type: a.type, ok: false, skipped: "noChannel" };
      state.messages++;
      const msg = await sendToChannel(ctx.guild, channelId, await buildMessage(a, ctx), src);
      return { type: a.type, ok: !!msg, error: msg ? undefined : "errors.botCannotWrite" };
    }
    case "reply": {
      const content = await renderText(a.content, ctx);
      if (ctx.interaction) {
        const payload = a.private ? { content, flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] } } : { content, allowedMentions: { parse: [] } };
        // Interactions were acknowledged with deferUpdate; replies go out as follow-ups
        await ctx.interaction.followUp(payload);
        state.replied = true;
        return { type: a.type, ok: true };
      }
      if (ctx.message) {
        await ctx.message.reply({ content, allowedMentions: { repliedUser: true, parse: [] } });
        return { type: a.type, ok: true };
      }
      return { type: a.type, ok: false, skipped: "noMessage" };
    }
    case "send_dm": {
      if (state.dms >= LIMITS.dmsPerRun) return { type: a.type, ok: false, skipped: "limit" };
      state.dms++;
      return result(await sendDm(ctx.guild, member!.user, await renderText(a.content, ctx), src));
    }
    case "add_roles":
      return result(await changeRoles("add", a.roleIds));
    case "remove_roles":
      return result(await changeRoles("remove", a.roleIds));
    case "toggle_roles": {
      const has = a.roleIds.filter((id) => member!.roles.cache.has(id));
      const missing = a.roleIds.filter((id) => !member!.roles.cache.has(id));
      const r1 = await changeRoles("remove", has);
      const r2 = await changeRoles("add", missing);
      return result(r1.ok ? r2 : r1);
    }
    case "temp_role": {
      const r = await changeRoles("add", a.roleIds);
      if (r.ok) {
        await scheduleJob({
          type: "automation.removeRoles",
          runAt: new Date(Date.now() + a.minutes * 60_000),
          guildId: ctx.guild.id,
          payload: { guildId: ctx.guild.id, userId: member!.id, roleIds: a.roleIds, ruleId: rule.id },
          // giving the same temp role again extends it instead of stacking jobs
          dedupeKey: `temprole:${ctx.guild.id}:${member!.id}:${[...a.roleIds].sort().join(",")}`,
        });
      }
      return result(r);
    }
    case "roles_from_select": {
      const picked = new Set(ctx.values ?? []);
      const give = a.mapping.filter((m) => picked.has(m.value)).map((m) => m.roleId);
      const take = a.mapping.filter((m) => !picked.has(m.value)).map((m) => m.roleId).filter((id) => !give.includes(id));
      const r1 = await changeRoles("remove", take);
      const r2 = await changeRoles("add", give);
      return result(r1.ok ? r2 : r1);
    }
    case "delete_message":
      if (!ctx.message) return { type: a.type, ok: false, skipped: "noMessage" };
      await ctx.message.delete();
      return { type: a.type, ok: true };
    case "add_reaction":
      if (!ctx.message) return { type: a.type, ok: false, skipped: "noMessage" };
      await ctx.message.react(a.emoji);
      return { type: a.type, ok: true };
    case "timeout":
      return result(await timeoutMember(member!, a.minutes * 60_000, { ...src, reason: (await renderText(a.reason, ctx)) || src.reason }));
    case "warn": {
      const { warn } = await import("../bot/modules/moderation.js");
      await warn(ctx.guild, member!, ctx.guild.client.user, (await renderText(a.reason, ctx)) || src.reason, "automod");
      return { type: a.type, ok: true };
    }
    case "give_xp": {
      const { levelFromXp, syncRewardRoles } = await import("../bot/modules/levels.js");
      const t = schema.memberLevels;
      const [row] = await db
        .insert(t)
        .values({ guildId: ctx.guild.id, userId: member!.id, username: member!.user.username, xp: Math.max(0, a.amount) })
        .onConflictDoUpdate({ target: [t.guildId, t.userId], set: { xp: dsql`greatest(0, ${t.xp} + ${a.amount})` } })
        .returning();
      const level = levelFromXp(row.xp).level;
      if (level !== row.level) await db.update(t).set({ level }).where(and(eq(t.guildId, ctx.guild.id), eq(t.userId, member!.id)));
      await syncRewardRoles(member!, level, (await getModule(ctx.guild.id, "levels")).config);
      return { type: a.type, ok: true };
    }
    case "set_nickname": {
      if (!member!.manageable) return { type: a.type, ok: false, error: "errors.missingPermission" };
      await member!.setNickname((await renderText(a.template, ctx)).slice(0, 32) || null, src.reason);
      return { type: a.type, ok: true };
    }
    case "counter": {
      const t = schema.memberCounters;
      const value = a.op === "set" ? a.value : a.op === "dec" ? -a.value : a.value;
      await db
        .insert(t)
        .values({ guildId: ctx.guild.id, userId: member!.id, key: a.key, value })
        .onConflictDoUpdate({
          target: [t.guildId, t.userId, t.key],
          set: { value: a.op === "set" ? a.value : dsql`${t.value} + ${value}`, updatedAt: new Date() },
        });
      return { type: a.type, ok: true };
    }
    case "log": {
      if (state.messages >= LIMITS.messagesPerRun) return { type: a.type, ok: false, skipped: "limit" };
      state.messages++;
      const msg = await sendToChannel(ctx.guild, a.channelId, { content: await renderText(a.content, ctx), allowedMentions: { parse: [] } }, src);
      return { type: a.type, ok: !!msg, error: msg ? undefined : "errors.botCannotWrite" };
    }
    case "wait":
      return { type: a.type, ok: true }; // handled by runActions
  }
}

/** Runs actions from `from`; a wait action schedules the rest as a job and stops. */
export async function runActions(rule: Rule, ctx: TriggerContext, from = 0) {
  const state: RunState = { roleChanges: 0, messages: 0, dms: 0, replied: false };
  const outcomes: ActionOutcome[] = [];
  for (let i = from; i < rule.actions.length && i - from < LIMITS.actionsPerRun; i++) {
    const a = rule.actions[i];
    if (a.type === "wait") {
      await scheduleJob({
        type: "automation.resume",
        runAt: new Date(Date.now() + a.minutes * 60_000),
        guildId: ctx.guild.id,
        payload: {
          ruleId: rule.id,
          guildId: ctx.guild.id,
          userId: ctx.userId ?? ctx.member?.id ?? null,
          channelId: ctx.channelId ?? null,
          messageId: ctx.message?.id ?? null,
          roleId: ctx.roleId ?? null,
          level: ctx.level ?? null,
          values: ctx.values ?? [],
          command: ctx.command ?? null,
          depth: ctx.depth ?? 0,
          from: i + 1,
        },
      });
      outcomes.push({ type: "wait", ok: true });
      break;
    }
    try {
      outcomes.push(await runAction(a, rule, ctx, state));
    } catch (err) {
      outcomes.push({ type: a.type, ok: false, error: (err as Error).message?.slice(0, 200) ?? "error" });
    }
  }
  return { outcomes, replied: state.replied };
}

/* ============================================================
 * Dispatch
 * ============================================================ */

async function recordRun(rule: Rule, ctx: TriggerContext, status: string, reason: string | null, detail: Record<string, unknown> = {}) {
  try {
    await db.insert(schema.automationRuns).values({
      automationId: rule.id,
      guildId: rule.guildId,
      userId: ctx.userId ?? ctx.member?.id ?? null,
      status,
      reason,
      detail,
    });
    if (status === "ok" || status === "partial") {
      await db
        .update(schema.automations)
        .set({ runCount: dsql`${schema.automations.runCount} + 1`, lastRunAt: new Date() })
        .where(eq(schema.automations.id, rule.id));
    }
  } catch (err) {
    log.warn({ err }, "automation run log failed");
  }
}

/** Guards + conditions + actions for one rule. Used by dispatch, schedules and the inactivity scan. */
export async function runRule(rule: Rule, ctx: TriggerContext): Promise<{ ran: boolean; replied: boolean }> {
  const userId = ctx.userId ?? ctx.member?.id ?? null;
  if ((ctx.depth ?? 0) >= LIMITS.maxDepth) {
    await recordRun(rule, ctx, "skipped", "loop");
    return { ran: false, replied: false };
  }
  if (!rateOk(ctx.guild.id)) {
    await recordRun(rule, ctx, "skipped", "rate");
    return { ran: false, replied: false };
  }
  if (rule.cooldownSeconds && userId) {
    const k = `${rule.id}:${userId}`;
    if ((cooldowns.get(k) ?? 0) > Date.now()) return { ran: false, replied: false }; // silent: would flood the log
    cooldowns.set(k, Date.now() + rule.cooldownSeconds * 1000);
  }
  try {
    const cond = await evaluateConditions(rule, ctx, dbFacts);
    if (!cond.pass) {
      await recordRun(rule, ctx, "skipped", "conditions", { conditions: cond.results });
      return { ran: false, replied: false };
    }
    const { outcomes, replied } = await runActions(rule, ctx);
    const failed = outcomes.filter((o) => !o.ok && !o.skipped).length;
    await recordRun(rule, ctx, failed === 0 ? "ok" : failed === outcomes.length ? "failed" : "partial", null, { actions: outcomes });
    return { ran: true, replied };
  } catch (err) {
    log.warn({ err, rule: rule.id }, "automation failed");
    await recordRun(rule, ctx, "failed", (err as Error).message?.slice(0, 200) ?? "error");
    return { ran: false, replied: false };
  }
}

export async function automationsEnabled(guildId: string) {
  return (await getModule(guildId, "automations")).enabled;
}

/**
 * Called by the gateway wiring for every event: finds the enabled rules whose trigger matches
 * and runs each one.
 */
export async function dispatch(type: TriggerType, ctx: TriggerContext, match: Parameters<typeof triggerMatches>[2] = {}) {
  if (!(await automationsEnabled(ctx.guild.id))) return { ran: 0, replied: false };
  const rules = (await rulesFor(ctx.guild.id)).filter((r) => r.enabled && triggerMatches(r.trigger, type, { ...ctx, ...match }));
  let ran = 0;
  let replied = false;
  for (const rule of rules) {
    const r = await runRule(rule, ctx);
    if (r.ran) ran++;
    replied ||= r.replied;
  }
  return { ran, replied };
}
