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
import { getModule } from "../../settings.js";
import { defineCommands } from "../registry.js";
import { recordEvent } from "./activity.js";
import { log } from "../../lib/log.js";

export type ModAction = "warn" | "timeout" | "kick" | "ban" | "unban" | "automod";

const actionLabel: Record<ModAction, string> = {
  warn: "Varning",
  timeout: "Timeout",
  kick: "Kick",
  ban: "Ban",
  unban: "Unban",
  automod: "Automod",
};
const actionColor: Record<ModAction, number> = {
  warn: 0xf59e0b,
  timeout: 0xf97316,
  kick: 0xef4444,
  ban: 0xb91c1c,
  unban: 0x22c55e,
  automod: 0x8b5cf6,
};

export async function createCase(
  guild: Guild,
  opts: { user: User; moderator: User; action: ModAction; reason: string; durationSeconds?: number },
) {
  const t = schema.modCases;
  // Retry on the (rare) unique conflict when two cases are created at the same instant
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [{ next }] = await db
        .select({ next: dsql<number>`coalesce(max(${t.caseNumber}), 0)::int + 1` })
        .from(t)
        .where(eq(t.guildId, guild.id));
      const [row] = await db
        .insert(t)
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
  if (!ch?.isTextBased()) return;
  const action = row.action as ModAction;
  const embed = new EmbedBuilder()
    .setColor(actionColor[action] ?? 0x8b5cf6)
    .setTitle(`Ärende #${row.caseNumber} · ${actionLabel[action] ?? row.action}`)
    .addFields(
      { name: "Användare", value: `<@${row.userId}> (${row.userTag})`, inline: true },
      { name: "Moderator", value: `<@${row.moderatorId}>`, inline: true },
      { name: "Anledning", value: row.reason || "—" },
    )
    .setTimestamp(row.createdAt);
  if (row.durationSeconds) embed.addFields({ name: "Längd", value: formatDuration(row.durationSeconds), inline: true });
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

export function formatDuration(s: number) {
  if (s % 86400 === 0) return `${s / 86400} d`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  return `${Math.round(s / 60)} min`;
}

/** "10m", "2h", "1d", "1w" -> seconds */
export function parseDuration(input: string): number | null {
  const m = input.trim().match(/^(\d+)\s*(s|m|min|h|d|w)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "m").toLowerCase();
  const mult = { s: 1, m: 60, min: 60, h: 3600, d: 86400, w: 604800 }[unit] ?? 60;
  return n * mult;
}

async function dmUser(guild: Guild, user: User, action: ModAction, reason: string, duration?: number) {
  const { config } = await getModule(guild.id, "moderation");
  if (!config.dmOnAction) return;
  const extra = duration ? ` (${formatDuration(duration)})` : "";
  await user
    .send(`Du har fått **${actionLabel[action].toLowerCase()}**${extra} på **${guild.name}**.${reason ? `\nAnledning: ${reason}` : ""}`)
    .catch(() => {});
}

export async function warnCount(guildId: string, userId: string) {
  const t = schema.modCases;
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.guildId, guildId), eq(t.userId, userId), dsql`${t.action} in ('warn','automod')`));
  return n;
}

/** Warn + run automatic escalation from moderation.warnThresholds */
export async function warn(guild: Guild, member: GuildMember, moderator: User, reason: string, action: ModAction = "warn") {
  await dmUser(guild, member.user, "warn", reason);
  const row = await createCase(guild, { user: member.user, moderator, action, reason });
  const { config } = await getModule(guild.id, "moderation");
  const count = await warnCount(guild.id, member.id);
  const step = config.warnThresholds.find((s) => s.count === count);
  if (step) {
    const why = `Automatiskt: ${count} varningar`;
    try {
      if (step.action === "timeout") {
        await member.timeout(step.durationMinutes * 60_000, why);
        await createCase(guild, { user: member.user, moderator: guild.client.user, action: "timeout", reason: why, durationSeconds: step.durationMinutes * 60 });
      } else if (step.action === "kick") {
        await member.kick(why);
        await createCase(guild, { user: member.user, moderator: guild.client.user, action: "kick", reason: why });
      } else {
        await member.ban({ reason: why });
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

const reasonOpt = (b: SlashCommandBuilder) => b.addStringOption((o) => o.setName("anledning").setDescription("Anledning").setMaxLength(500));

export function registerModeration() {
  const eph = { flags: MessageFlags.Ephemeral } as const;

  defineCommands([
    {
      module: "moderation",
      data: reasonOpt(
        new SlashCommandBuilder()
          .setName("warn")
          .setDescription("Varna en medlem")
          .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
          .addUserOption((o) => o.setName("user").setDescription("Medlem").setRequired(true)) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const target = i.options.getMember("user");
        if (!target) return i.reply({ content: "Hittade inte medlemmen.", ...eph });
        if (!canActOn(i.member, target)) return i.reply({ content: "Du kan inte moderera den medlemmen.", ...eph });
        const reason = i.options.getString("anledning") ?? "";
        const { row, count } = await warn(i.guild, target, i.user, reason);
        return i.reply({ content: `⚠️ ${target} varnades (ärende #${row.caseNumber}, ${count} varningar totalt).`, allowedMentions: { parse: [] } });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        new SlashCommandBuilder()
          .setName("timeout")
          .setDescription("Sätt en medlem i timeout")
          .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
          .addUserOption((o) => o.setName("user").setDescription("Medlem").setRequired(true))
          .addStringOption((o) => o.setName("tid").setDescription("t.ex. 10m, 2h, 1d (max 28d)").setRequired(true)) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const target = i.options.getMember("user");
        const secs = parseDuration(i.options.getString("tid", true));
        if (!target) return i.reply({ content: "Hittade inte medlemmen.", ...eph });
        if (!secs || secs > 28 * 86400) return i.reply({ content: "Ogiltig tid. Använd t.ex. 10m, 2h eller 1d (max 28d).", ...eph });
        if (!canActOn(i.member, target) || !target.moderatable) return i.reply({ content: "Jag eller du kan inte moderera den medlemmen.", ...eph });
        const reason = i.options.getString("anledning") ?? "";
        await dmUser(i.guild, target.user, "timeout", reason, secs);
        await target.timeout(secs * 1000, reason || undefined);
        const row = await createCase(i.guild, { user: target.user, moderator: i.user, action: "timeout", reason, durationSeconds: secs });
        return i.reply({ content: `🔇 ${target} fick timeout i ${formatDuration(secs)} (ärende #${row.caseNumber}).`, allowedMentions: { parse: [] } });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        new SlashCommandBuilder()
          .setName("kick")
          .setDescription("Kicka en medlem")
          .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
          .addUserOption((o) => o.setName("user").setDescription("Medlem").setRequired(true)) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const target = i.options.getMember("user");
        if (!target) return i.reply({ content: "Hittade inte medlemmen.", ...eph });
        if (!canActOn(i.member, target) || !target.kickable) return i.reply({ content: "Jag eller du kan inte kicka den medlemmen.", ...eph });
        const reason = i.options.getString("anledning") ?? "";
        await dmUser(i.guild, target.user, "kick", reason);
        await target.kick(reason || undefined);
        const row = await createCase(i.guild, { user: target.user, moderator: i.user, action: "kick", reason });
        return i.reply({ content: `👢 ${target.user.username} kickades (ärende #${row.caseNumber}).` });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        new SlashCommandBuilder()
          .setName("ban")
          .setDescription("Banna en användare")
          .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
          .addUserOption((o) => o.setName("user").setDescription("Användare").setRequired(true))
          .addIntegerOption((o) =>
            o.setName("radera_dagar").setDescription("Radera meddelanden från senaste X dagar (0-7)").setMinValue(0).setMaxValue(7),
          ) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const user = i.options.getUser("user", true);
        const member = i.options.getMember("user");
        if (member && (!canActOn(i.member, member) || !member.bannable))
          return i.reply({ content: "Jag eller du kan inte banna den medlemmen.", ...eph });
        const reason = i.options.getString("anledning") ?? "";
        const days = i.options.getInteger("radera_dagar") ?? 0;
        await dmUser(i.guild, user, "ban", reason);
        await i.guild.members.ban(user, { reason: reason || undefined, deleteMessageSeconds: days * 86400 });
        const row = await createCase(i.guild, { user, moderator: i.user, action: "ban", reason });
        return i.reply({ content: `🔨 ${user.username} bannades (ärende #${row.caseNumber}).` });
      },
    },
    {
      module: "moderation",
      data: reasonOpt(
        new SlashCommandBuilder()
          .setName("unban")
          .setDescription("Häv en ban")
          .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
          .addStringOption((o) => o.setName("user_id").setDescription("Användar-ID").setRequired(true)) as SlashCommandBuilder,
      ).toJSON(),
      async execute(i) {
        const id = i.options.getString("user_id", true).trim();
        const reason = i.options.getString("anledning") ?? "";
        const user = await i.guild.members.unban(id, reason || undefined).catch(() => null);
        if (!user) return i.reply({ content: "Den användaren är inte bannad.", ...eph });
        const row = await createCase(i.guild, { user, moderator: i.user, action: "unban", reason });
        return i.reply({ content: `✅ ${user.username} är inte längre bannad (ärende #${row.caseNumber}).` });
      },
    },
    {
      module: "moderation",
      data: new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Radera meddelanden i kanalen")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption((o) => o.setName("antal").setDescription("1-100").setMinValue(1).setMaxValue(100).setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("Bara från denna användare"))
        .toJSON(),
      async execute(i) {
        const amount = i.options.getInteger("antal", true);
        const user = i.options.getUser("user");
        if (!i.channel || !("bulkDelete" in i.channel)) return i.reply({ content: "Fungerar inte i den här kanalen.", ...eph });
        await i.deferReply(eph);
        let msgs = await i.channel.messages.fetch({ limit: 100 });
        if (user) msgs = msgs.filter((m) => m.author.id === user.id);
        const deleted = await i.channel.bulkDelete([...msgs.values()].slice(0, amount), true);
        return i.editReply(`🧹 Raderade ${deleted.size} meddelanden.`);
      },
    },
    {
      module: "moderation",
      data: new SlashCommandBuilder()
        .setName("cases")
        .setDescription("Visa moderationshistorik för en användare")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption((o) => o.setName("user").setDescription("Användare").setRequired(true))
        .toJSON(),
      async execute(i) {
        const user = i.options.getUser("user", true);
        const t = schema.modCases;
        const rows = await db
          .select()
          .from(t)
          .where(and(eq(t.guildId, i.guildId), eq(t.userId, user.id)))
          .orderBy(desc(t.createdAt))
          .limit(15);
        if (!rows.length) return i.reply({ content: `${user.username} har inga ärenden.`, ...eph });
        const lines = rows.map(
          (r) =>
            `**#${r.caseNumber}** ${actionLabel[r.action as ModAction] ?? r.action} · <t:${Math.floor(r.createdAt.getTime() / 1000)}:d> · ${r.reason || "—"}`,
        );
        return i.reply({
          embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`Ärenden för ${user.username}`).setDescription(lines.join("\n"))],
          ...eph,
        });
      },
    },
  ]);
}
