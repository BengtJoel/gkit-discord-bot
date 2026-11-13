import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
  type Guild,
  type GuildMember,
  type User,
} from "discord.js";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { brandColor, getModule } from "../../settings.js";
import { defineCommands } from "../registry.js";
import { recordEvent } from "./activity.js";
import { log } from "../../lib/log.js";
import { guildT, userT, t, type Lang } from "../../i18n/index.js";
import { banUser, kickMember, sendDm, timeoutMember, unbanUser } from "../../core/actions.js";
import { cancelJob, registerJobHandler, scheduleJob } from "../../core/jobs.js";

export type ModAction = "warn" | "timeout" | "kick" | "ban" | "tempban" | "unban" | "automod";

const actionColor: Record<ModAction, number> = {
  warn: 0xf59e0b,
  timeout: 0xf97316,
  kick: 0xef4444,
  ban: 0xb91c1c,
  tempban: 0xdc2626,
  unban: 0x22c55e,
  automod: 0x8b5cf6,
};

const actionName = (lang: Lang, a: string) => t(lang, `moderation.actions.${a}`);

export async function createCase(
  guild: Guild,
  opts: { user: User; moderator: User; action: ModAction; reason: string; durationSeconds?: number },
) {
  const tbl = schema.modCases;
  // Retry on the (rare) unique conflict when two cases are created at the same instant
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [{ next }] = await db
        .select({ next: dsql<number>`coalesce(max(${tbl.caseNumber}), 0)::int + 1` })
        .from(tbl)
        .where(eq(tbl.guildId, guild.id));
      const [row] = await db
        .insert(tbl)
        .values({
          guildId: guild.id,
          caseNumber: next,
          userId: opts.user.id,
          userTag: opts.user.username,
          moderatorId: opts.moderator.id,
          moderatorTag: opts.moderator.username,
          action: opts.action,
          reason: opts.reason,
          durationSeconds: opts.durationSeconds ?? null,
        })
        .returning();
      await recordEvent(guild.id, "mod_action", {
        userId: opts.user.id,
        data: { action: opts.action, reason: opts.reason, moderatorId: opts.moderator.id, case: row.caseNumber },
      });
      await sendModLog(guild, row);
      return row;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

async function sendModLog(guild: Guild, row: typeof schema.modCases.$inferSelect) {
  const { config } = await getModule(guild.id, "moderation");
  if (!config.logChannelId) return;
  const ch = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!ch?.isSendable()) return;
  const tr = await guildT(guild);
  const action = row.action as ModAction;
  const embed = new EmbedBuilder()
    .setColor(actionColor[action] ?? 0x8b5cf6)
    .setTitle(tr("moderation.caseTitle", { n: row.caseNumber, action: actionName(tr.lang, action) }))
    .addFields(
      { name: tr("moderation.user"), value: `<@${row.userId}> (${row.userTag})`, inline: true },
      { name: tr("moderation.moderator"), value: `<@${row.moderatorId}>`, inline: true },
      { name: tr("moderation.reason"), value: row.reason || "—" },
    )
    .setTimestamp(row.createdAt);
  if (row.durationSeconds) embed.addFields({ name: tr("moderation.duration"), value: formatDuration(row.durationSeconds), inline: true });
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

export function formatDuration(s: number) {
  if (s % 604800 === 0) return `${s / 604800} w`;
  if (s % 86400 === 0) return `${s / 86400} d`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  return `${Math.round(s / 60)} min`;
}

/** "10m", "2h", "1d", "1w", "1w2d3h" -> seconds */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 60;
  const re = /(\d+)\s*(w|d|h|min|m|s)/g;
  let total = 0;
  let consumed = "";
  for (const m of s.matchAll(re)) {
    total += Number(m[1]) * ({ s: 1, m: 60, min: 60, h: 3600, d: 86400, w: 604800 } as Record<string, number>)[m[2]];
    consumed += m[0];
  }
  return total > 0 && consumed.replace(/\s/g, "") === s.replace(/\s/g, "") ? total : null;
}

async function dmUser(guild: Guild, user: User, action: ModAction, reason: string, duration?: number) {
  const { config } = await getModule(guild.id, "moderation");
  if (!config.dmOnAction) return;
  const tr = await guildT(guild);
  const extra = duration ? ` (${formatDuration(duration)})` : "";
  const text = [
    tr("moderation.dm", { action: actionName(tr.lang, action).toLowerCase(), extra, server: guild.name }),
    reason ? tr("moderation.dmReason", { reason }) : "",
  ]
    .filter(Boolean)
    .join("\n");
  await sendDm(guild, user, text, { source: "moderation" });
}

export async function warnCount(guildId: string, userId: string) {
  const tbl = schema.modCases;
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(tbl)
    .where(and(eq(tbl.guildId, guildId), eq(tbl.userId, userId), dsql`${tbl.action} in ('warn','automod')`));
  return n;
}

export async function isImmune(member: GuildMember) {
  const { config } = await getModule(member.guild.id, "moderation");
  return member.roles.cache.some((r) => config.immuneRoleIds.includes(r.id));
}

/** Warn + run automatic escalation from moderation.warnThresholds */
export async function warn(guild: Guild, member: GuildMember, moderator: User, reason: string, action: ModAction = "warn") {
  await dmUser(guild, member.user, "warn", reason);
  const row = await createCase(guild, { user: member.user, moderator, action, reason });
  const { config } = await getModule(guild.id, "moderation");
  const count = await warnCount(guild.id, member.id);
  const step = config.warnThresholds.find((s) => s.count === count);
  if (step) {
    const tr = await guildT(guild);
    const why = tr("moderation.autoEscalation", { count });
    const ctx = { source: "moderation", reason: why };
    try {
      if (step.action === "timeout") {
        await timeoutMember(member, step.durationMinutes * 60_000, ctx);
        await createCase(guild, { user: member.user, moderator: guild.client.user, action: "timeout", reason: why, durationSeconds: step.durationMinutes * 60 });
      } else if (step.action === "kick") {
        await kickMember(member, ctx);
        await createCase(guild, { user: member.user, moderator: guild.client.user, action: "kick", reason: why });
      } else {
        await banUser(guild, member.id, ctx);
        await createCase(guild, { user: member.user, moderator: guild.client.user, action: "ban", reason: why });
      }
    } catch (err) {
      log.warn({ err }, "warn escalation failed");
    }
  }
  return { row, count };
}

function canActOn(actor: GuildMember, target: GuildMember) {
  if (target.id === actor.guild.ownerId) return false;
  if (actor.id === actor.guild.ownerId) return true;
  return actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

const unbanKey = (guildId: string, userId: string) => `unban:${guildId}:${userId}`;

export function registerModeration() {
  const eph = { flags: MessageFlags.Ephemeral } as const;

  registerJobHandler("moderation.unban", async (p) => {
    const { client } = await import("../client.js");
    const guild = client.guilds.cache.get(String(p.guildId));
    if (!guild) return; // bot left the server; nothing to do
    const tr = await guildT(guild);
    const user = await unbanUser(guild, String(p.userId), { source: "moderation", reason: tr("moderation.tempbanExpired") });
    if (user) await createCase(guild, { user, moderator: client.user!, action: "unban", reason: tr("moderation.tempbanExpired") });
  });

  /** Shared checks for commands that target a member. Returns an error key or null. */
  const checkTarget = async (actor: GuildMember, target: GuildMember | null, botCan = true) => {
    if (!target) return "moderation.memberNotFound" as const;
    if (await isImmune(target)) return "moderation.immune" as const;
    if (!canActOn(actor, target) || !botCan) return "moderation.cannotModerateEither" as const;
    return null;
  };

  const userOpt = (b: SlashCommandBuilder, required = true) => b.addUserOption((o) => o.setName("user").setDescription("user").setRequired(required));
  const reasonOpt = <T extends { addStringOption: SlashCommandBuilder["addStringOption"] }>(b: T) =>
    b.addStringOption((o) => o.setName("reason").setDescription("reason").setMaxLength(500));

  defineCommands([
    {
      module: "moderation",
      data: reasonOpt(userOpt(new SlashCommandBuilder().setName("warn").setDescription("warn").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)) as SlashCommandBuilder).toJSON(),
      async execute(i) {
        const target = i.options.getMember("user");
        const err = await checkTarget(i.member, target);
        if (err) return i.reply({ content: userT(i)(err), ...eph });
        const reason = i.options.getString("reason") ?? "";
        const { row, count } = await warn(i.guild, target!, i.user, reason);
        const tr = await guildT(i.guild);
        return i.reply({ content: tr("moderation.warned", { user: `${target}`, n: row.caseNumber, count }), allowedMentions: { parse: [] } });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        userOpt(new SlashCommandBuilder().setName("timeout").setDescription("timeout").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)).addStringOption(
          (o) => o.setName("duration").setDescription("duration").setRequired(true),
        ) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const target = i.options.getMember("user");
        const secs = parseDuration(i.options.getString("duration", true));
        if (!secs || secs > 28 * 86400) return i.reply({ content: userT(i)("moderation.invalidDuration"), ...eph });
        const err = await checkTarget(i.member, target, !!target?.moderatable);
        if (err) return i.reply({ content: userT(i)(err), ...eph });
        const reason = i.options.getString("reason") ?? "";
        await dmUser(i.guild, target!.user, "timeout", reason, secs);
        await timeoutMember(target!, secs * 1000, { source: "moderation", reason: reason || undefined });
        const row = await createCase(i.guild, { user: target!.user, moderator: i.user, action: "timeout", reason, durationSeconds: secs });
        const tr = await guildT(i.guild);
        return i.reply({ content: tr("moderation.timedOut", { user: `${target}`, duration: formatDuration(secs), n: row.caseNumber }), allowedMentions: { parse: [] } });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(userOpt(new SlashCommandBuilder().setName("kick").setDescription("kick").setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)) as SlashCommandBuilder).toJSON(),
      async execute(i) {
        const target = i.options.getMember("user");
        const err = await checkTarget(i.member, target, !!target?.kickable);
        if (err) return i.reply({ content: userT(i)(err), ...eph });
        const reason = i.options.getString("reason") ?? "";
        await dmUser(i.guild, target!.user, "kick", reason);
        await kickMember(target!, { source: "moderation", reason: reason || undefined });
        const row = await createCase(i.guild, { user: target!.user, moderator: i.user, action: "kick", reason });
        const tr = await guildT(i.guild);
        return i.reply({ content: tr("moderation.kicked", { user: target!.user.username, n: row.caseNumber }) });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        userOpt(new SlashCommandBuilder().setName("ban").setDescription("ban").setDefaultMemberPermissions(PermissionFlagsBits.BanMembers))
          .addStringOption((o) => o.setName("duration").setDescription("duration"))
          .addIntegerOption((o) => o.setName("delete_days").setDescription("delete_days").setMinValue(0).setMaxValue(7)) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const user = i.options.getUser("user", true);
        const member = i.options.getMember("user");
        if (member) {
          const err = await checkTarget(i.member, member, member.bannable);
          if (err) return i.reply({ content: userT(i)(err), ...eph });
        }
        const durationInput = i.options.getString("duration");
        const secs = durationInput ? parseDuration(durationInput) : null;
        if (durationInput && !secs) return i.reply({ content: userT(i)("moderation.invalidBanDuration"), ...eph });
        const reason = i.options.getString("reason") ?? "";
        const days = i.options.getInteger("delete_days") ?? 0;
        await dmUser(i.guild, user, secs ? "tempban" : "ban", reason, secs ?? undefined);
        const res = await banUser(i.guild, user.id, { source: "moderation", reason: reason || undefined }, days * 86400);
        if (!res.ok) return i.reply({ content: userT(i)("moderation.cannotModerateEither"), ...eph });
        const tr = await guildT(i.guild);
        if (secs) {
          await scheduleJob({
            type: "moderation.unban",
            runAt: new Date(Date.now() + secs * 1000),
            guildId: i.guildId,
            payload: { guildId: i.guildId, userId: user.id },
            dedupeKey: unbanKey(i.guildId, user.id),
          });
          const row = await createCase(i.guild, { user, moderator: i.user, action: "tempban", reason, durationSeconds: secs });
          return i.reply({ content: tr("moderation.tempBanned", { user: user.username, duration: formatDuration(secs), n: row.caseNumber }) });
        }
        await cancelJob(unbanKey(i.guildId, user.id)); // a permanent ban replaces a temporary one
        const row = await createCase(i.guild, { user, moderator: i.user, action: "ban", reason });
        return i.reply({ content: tr("moderation.banned", { user: user.username, n: row.caseNumber }) });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        new SlashCommandBuilder()
          .setName("unban")
          .setDescription("unban")
          .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
          .addStringOption((o) => o.setName("user_id").setDescription("user_id").setRequired(true)),
      ).toJSON(),
      async execute(i) {
        const id = i.options.getString("user_id", true).trim();
        const reason = i.options.getString("reason") ?? "";
        const user = await unbanUser(i.guild, id, { source: "moderation", reason: reason || undefined });
        if (!user) return i.reply({ content: userT(i)("moderation.notBanned"), ...eph });
        await cancelJob(unbanKey(i.guildId, id));
        const row = await createCase(i.guild, { user, moderator: i.user, action: "unban", reason });
        const tr = await guildT(i.guild);
        return i.reply({ content: tr("moderation.unbanned", { user: user.username, n: row.caseNumber }) });
      },
    },
    {
      module: "moderation",
      data: new SlashCommandBuilder()
        .setName("purge")
        .setDescription("purge")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption((o) => o.setName("amount").setDescription("amount").setMinValue(1).setMaxValue(100).setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("user"))
        .toJSON(),
      async execute(i) {
        const amount = i.options.getInteger("amount", true);
        const user = i.options.getUser("user");
        const tu = userT(i);
        if (!i.channel || !("bulkDelete" in i.channel)) return i.reply({ content: tu("moderation.purgeUnsupported"), ...eph });
        await i.deferReply(eph);
        let msgs = await i.channel.messages.fetch({ limit: 100 });
        if (user) msgs = msgs.filter((m) => m.author.id === user.id);
        const deleted = await i.channel.bulkDelete([...msgs.values()].slice(0, amount), true);
        return i.editReply(tu("moderation.purged", { count: deleted.size }));
      },
    },
    {
      module: "moderation",
      data: new SlashCommandBuilder()
        .setName("cases")
        .setDescription("cases")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption((o) => o.setName("user").setDescription("user").setRequired(true))
        .toJSON(),
      async execute(i) {
        const user = i.options.getUser("user", true);
        const tu = userT(i);
        const tbl = schema.modCases;
        const rows = await db
          .select()
          .from(tbl)
          .where(and(eq(tbl.guildId, i.guildId), eq(tbl.userId, user.id)))
          .orderBy(desc(tbl.createdAt))
          .limit(15);
        if (!rows.length) return i.reply({ content: tu("moderation.noCases", { user: user.username }), ...eph });
        const lines = rows.map(
          (r) => `**#${r.caseNumber}** ${actionName(tu.lang, r.action)} · <t:${Math.floor(r.createdAt.getTime() / 1000)}:d> · ${r.reason || "—"}`,
        );
        return i.reply({
          embeds: [new EmbedBuilder().setColor(await brandColor(i.guildId)).setTitle(tu("moderation.casesTitle", { user: user.username })).setDescription(lines.join("\n"))],
          ...eph,
        });
      },
    },
  ]);
}
