import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  type User,
  type Message,
} from "discord.js";
import { lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { log } from "../lib/log.js";

/**
 * Shared action layer. Every module (and later automations) changes Discord through these
 * functions so permission checks, error handling and the action log live in one place.
 * Actions never throw for expected problems (missing permission, role too high); they
 * return { ok:false, code } and write the reason to action_log so admins can see why.
 */
export interface ActionCtx {
  /** Module or rule that caused the action, e.g. "levels", "automation:12" */
  source: string;
  reason?: string;
}

export interface ActionResult {
  ok: boolean;
  /** i18n key under errors.* when not ok */
  code?: string;
  params?: Record<string, string>;
}

async function record(guildId: string, ctx: ActionCtx, action: string, targetId: string | null, res: ActionResult, data: Record<string, unknown> = {}) {
  try {
    await db.insert(schema.actionLog).values({
      guildId,
      source: ctx.source,
      action,
      targetId,
      ok: res.ok,
      error: res.ok ? null : res.code ?? "unknown",
      data: { ...data, ...(res.params ?? {}), ...(ctx.reason ? { reason: ctx.reason } : {}) },
    });
  } catch (err) {
    log.warn({ err }, "action log write failed");
  }
}

const fail = (code: string, params?: Record<string, string>): ActionResult => ({ ok: false, code, params });
const OK: ActionResult = { ok: true };

/** Splits role ids into ones the bot can manage and ones it can't (missing perm, managed, too high, deleted) */
export function checkRoles(guild: Guild, roleIds: string[]) {
  const me = guild.members.me;
  const ok: string[] = [];
  const blocked: { id: string; code: string; params?: Record<string, string> }[] = [];
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok, blocked: roleIds.map((id) => ({ id, code: "errors.missingPermission", params: { permission: "Manage Roles" } })) };
  }
  for (const id of roleIds) {
    const role = guild.roles.cache.get(id);
    if (!role) blocked.push({ id, code: "errors.notFound" });
    else if (role.managed || role.id === guild.id || me.roles.highest.comparePositionTo(role) <= 0)
      blocked.push({ id, code: "errors.roleTooHigh", params: { role: role.name } });
    else ok.push(id);
  }
  return { ok, blocked };
}

async function changeRoles(kind: "add" | "remove", member: GuildMember, roleIds: string[], ctx: ActionCtx): Promise<ActionResult> {
  const wanted = [...new Set(roleIds)].filter((id) => (kind === "add" ? !member.roles.cache.has(id) : member.roles.cache.has(id)));
  if (!wanted.length) return OK;
  const { ok, blocked } = checkRoles(member.guild, wanted);
  for (const b of blocked) await record(member.guild.id, ctx, `role.${kind}`, member.id, fail(b.code, b.params), { roleId: b.id });
  if (!ok.length) return blocked.length ? fail(blocked[0].code, blocked[0].params) : OK;
  try {
    if (kind === "add") await member.roles.add(ok, ctx.reason);
    else await member.roles.remove(ok, ctx.reason);
    await record(member.guild.id, ctx, `role.${kind}`, member.id, OK, { roleIds: ok });
    return blocked.length ? fail(blocked[0].code, blocked[0].params) : OK;
  } catch (err) {
    const res = fail("errors.serverError", { detail: (err as Error).message });
    await record(member.guild.id, ctx, `role.${kind}`, member.id, res, { roleIds: ok });
    return res;
  }
}

export const addRoles = (member: GuildMember, roleIds: string[], ctx: ActionCtx) => changeRoles("add", member, roleIds, ctx);
export const removeRoles = (member: GuildMember, roleIds: string[], ctx: ActionCtx) => changeRoles("remove", member, roleIds, ctx);

export async function sendToChannel(guild: Guild, channelId: string, payload: string | MessageCreateOptions, ctx: ActionCtx): Promise<Message | null> {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isSendable()) {
    await record(guild.id, ctx, "message.send", channelId, fail("errors.botCannotWrite"));
    return null;
  }
  try {
    const msg = await ch.send(payload);
    return msg;
  } catch (err) {
    await record(guild.id, ctx, "message.send", channelId, fail("errors.botCannotWrite", { detail: (err as Error).message }));
    return null;
  }
}

/** DMs fail silently for users with closed DMs — that's expected and only logged */
export async function sendDm(guild: Guild, user: User, payload: string | MessageCreateOptions, ctx: ActionCtx) {
  try {
    await user.send(payload);
    return OK;
  } catch {
    const res = fail("errors.dmClosed");
    await record(guild.id, ctx, "dm.send", user.id, res);
    return res;
  }
}

export async function timeoutMember(member: GuildMember, ms: number | null, ctx: ActionCtx) {
  if (!member.moderatable) {
    const res = fail("errors.missingPermission", { permission: "Moderate Members" });
    await record(member.guild.id, ctx, "member.timeout", member.id, res);
    return res;
  }
  await member.timeout(ms, ctx.reason);
  await record(member.guild.id, ctx, "member.timeout", member.id, OK, { ms });
  return OK;
}

export async function kickMember(member: GuildMember, ctx: ActionCtx) {
  if (!member.kickable) {
    const res = fail("errors.missingPermission", { permission: "Kick Members" });
    await record(member.guild.id, ctx, "member.kick", member.id, res);
    return res;
  }
  await member.kick(ctx.reason);
  await record(member.guild.id, ctx, "member.kick", member.id, OK);
  return OK;
}

export async function banUser(guild: Guild, userId: string, ctx: ActionCtx, deleteMessageSeconds = 0) {
  try {
    await guild.members.ban(userId, { reason: ctx.reason, deleteMessageSeconds });
    await record(guild.id, ctx, "member.ban", userId, OK);
    return OK;
  } catch (err) {
    const res = fail("errors.missingPermission", { permission: "Ban Members", detail: (err as Error).message });
    await record(guild.id, ctx, "member.ban", userId, res);
    return res;
  }
}

export async function unbanUser(guild: Guild, userId: string, ctx: ActionCtx) {
  const user = await guild.members.unban(userId, ctx.reason).catch(() => null);
  await record(guild.id, ctx, "member.unban", userId, user ? OK : fail("errors.notFound"));
  return user;
}

/** Keep the log bounded: entries older than 30 days are removed */
export async function pruneActionLog() {
  await db.delete(schema.actionLog).where(lt(schema.actionLog.createdAt, new Date(Date.now() - 30 * 86400_000)));
}
