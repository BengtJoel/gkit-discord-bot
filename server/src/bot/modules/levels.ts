import { Events, SlashCommandBuilder, EmbedBuilder, MessageFlags, type Client, type GuildMember, type Message } from "discord.js";
import { and, desc, eq, gt, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { brandColor, enabledConfig, getModule, type ModuleConfig } from "../../settings.js";
import { renderTemplate } from "../../lib/template.js";
import { defineCommands } from "../registry.js";
import { recordEvent } from "./activity.js";
import { log } from "../../lib/log.js";
import { guildT, userT, t, fmtNumber } from "../../i18n/index.js";
import { addRoles, removeRoles } from "../../core/actions.js";
import { bus } from "../../core/events.js";

/* Same curve as MEE6 so imported XP maps to identical levels:
 * XP needed to go from level n to n+1 = 5n² + 50n + 100 */
export const xpForNext = (level: number) => 5 * level * level + 50 * level + 100;

export function levelFromXp(totalXp: number) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForNext(level)) {
    remaining -= xpForNext(level);
    level++;
  }
  return { level, current: remaining, needed: xpForNext(level) };
}

export function totalXpForLevel(level: number) {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpForNext(l);
  return total;
}

const cooldowns = new Map<string, number>();

async function handleMessage(msg: Message<true>) {
  const cfg = await enabledConfig(msg.guildId, "levels");
  if (!cfg) return;
  if (cfg.noXpChannelIds.includes(msg.channelId)) return;
  if (msg.channel.isThread() && msg.channel.parentId && cfg.noXpChannelIds.includes(msg.channel.parentId)) return;
  const member = msg.member;
  if (!member || member.roles.cache.some((r) => cfg.noXpRoleIds.includes(r.id))) return;

  const k = `${msg.guildId}|${msg.author.id}`;
  const now = Date.now();
  if ((cooldowns.get(k) ?? 0) > now) return;
  cooldowns.set(k, now + cfg.cooldownSeconds * 1000);

  const lo = Math.min(cfg.xpMin, cfg.xpMax);
  const hi = Math.max(cfg.xpMin, cfg.xpMax);
  const gain = Math.round((lo + Math.floor(Math.random() * (hi - lo + 1))) * cfg.multiplier);
  if (gain <= 0) return;

  const tbl = schema.memberLevels;
  const [row] = await db
    .insert(tbl)
    .values({
      guildId: msg.guildId,
      userId: msg.author.id,
      username: msg.author.username,
      avatar: msg.author.avatar,
      xp: gain,
      messageCount: 1,
      lastXpAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tbl.guildId, tbl.userId],
      set: {
        xp: dsql`${tbl.xp} + ${gain}`,
        messageCount: dsql`${tbl.messageCount} + 1`,
        username: msg.author.username,
        avatar: msg.author.avatar,
        lastXpAt: new Date(),
      },
    })
    .returning();

  const { level } = levelFromXp(row.xp);
  if (level > row.level) {
    await db.update(tbl).set({ level }).where(and(eq(tbl.guildId, msg.guildId), eq(tbl.userId, msg.author.id)));
    await onLevelUp(msg, member, level, row.level, cfg);
  }
}

async function onLevelUp(msg: Message<true>, member: GuildMember, level: number, previous: number, cfg: ModuleConfig<"levels">) {
  await recordEvent(msg.guildId, "level_up", { userId: member.id, channelId: msg.channelId, data: { level } });
  bus.emit("level.reached", member, level, previous);
  await syncRewardRoles(member, level, cfg);

  if (cfg.announce.mode === "off") return;
  const tr = await guildT(msg.guild);
  const template = cfg.announce.message || tr("defaults.levelUp");
  const text = renderTemplate(template, { member, guild: msg.guild, extra: { level } });
  try {
    if (cfg.announce.mode === "dm") await member.send(text);
    else if (cfg.announce.mode === "channel" && cfg.announce.channelId) {
      const ch = await msg.guild.channels.fetch(cfg.announce.channelId);
      if (ch?.isSendable()) await ch.send(text);
    } else if (msg.channel.isSendable()) await msg.channel.send(text);
  } catch (err) {
    log.debug({ err }, "level announce failed");
  }
}

/**
 * Makes a member's reward roles match their level:
 * adds earned rewards, removes lower ones when not stacking, and removes rewards above
 * their level when removeOnDemote is on (e.g. after an admin lowered their XP).
 */
export async function syncRewardRoles(member: GuildMember, level: number, cfg: ModuleConfig<"levels">) {
  const lang = (await guildT(member.guild)).lang;
  const earned = cfg.roleRewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const keep = cfg.stackRewards ? earned : earned.slice(-1);
  const replaced = cfg.stackRewards ? [] : earned.slice(0, -1);
  const above = cfg.removeOnDemote ? cfg.roleRewards.filter((r) => r.level > level) : [];
  const keepIds = new Set(keep.map((r) => r.roleId));

  if (keep.length) await addRoles(member, [...keepIds], { source: "levels", reason: t(lang, "levels.rewardReason", { level }) });
  const removeReplaced = replaced.map((r) => r.roleId).filter((id) => !keepIds.has(id));
  if (removeReplaced.length)
    await removeRoles(member, removeReplaced, { source: "levels", reason: t(lang, "levels.rewardRemovedReason", { level }) });
  const removeAbove = above.map((r) => r.roleId).filter((id) => !keepIds.has(id));
  if (removeAbove.length) await removeRoles(member, removeAbove, { source: "levels", reason: t(lang, "levels.demotedReason", { level }) });
}

export async function getRank(guildId: string, userId: string) {
  const tbl = schema.memberLevels;
  const [row] = await db.select().from(tbl).where(and(eq(tbl.guildId, guildId), eq(tbl.userId, userId)));
  if (!row) return null;
  const [{ count }] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(tbl)
    .where(and(eq(tbl.guildId, guildId), gt(tbl.xp, row.xp)));
  return { ...row, rank: count + 1, ...levelFromXp(row.xp) };
}

function bar(current: number, needed: number, width = 16) {
  const filled = Math.round((current / needed) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function registerLevels(client: Client) {
  client.on(Events.MessageCreate, (msg) => {
    if (!msg.inGuild() || msg.author.bot || msg.webhookId) return;
    handleMessage(msg).catch((err) => log.error({ err }, "levels handler failed"));
  });

  // A member who comes back gets their reward roles again
  client.on(Events.GuildMemberAdd, async (member) => {
    const { enabled, config } = await getModule(member.guild.id, "levels");
    if (!enabled || !config.roleRewards.length) return;
    const r = await getRank(member.guild.id, member.id);
    if (r && r.level > 0) await syncRewardRoles(member, r.level, config).catch(() => {});
  });

  defineCommands([
    {
      module: "levels",
      data: new SlashCommandBuilder()
        .setName("rank")
        .setDescription("rank")
        .addUserOption((o) => o.setName("user").setDescription("user"))
        .toJSON(),
      async execute(i) {
        const user = i.options.getUser("user") ?? i.user;
        const r = await getRank(i.guildId, user.id);
        if (!r) return i.reply({ content: userT(i)("levels.noXp", { user: `${user}` }), flags: MessageFlags.Ephemeral });
        const tr = await guildT(i.guild);
        const embed = new EmbedBuilder()
          .setColor(await brandColor(i.guildId))
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .addFields(
            { name: tr("levels.rank"), value: `#${r.rank}`, inline: true },
            { name: tr("levels.level"), value: String(r.level), inline: true },
            { name: tr("levels.xp"), value: `${fmtNumber(tr.lang, r.current)} / ${fmtNumber(tr.lang, r.needed)}`, inline: true },
          )
          .setDescription(bar(r.current, r.needed));
        return i.reply({ embeds: [embed] });
      },
    },
    {
      module: "levels",
      data: new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription("leaderboard")
        .addIntegerOption((o) => o.setName("page").setDescription("page").setMinValue(1))
        .toJSON(),
      async execute(i) {
        const page = (i.options.getInteger("page") ?? 1) - 1;
        const tbl = schema.memberLevels;
        const rows = await db
          .select()
          .from(tbl)
          .where(eq(tbl.guildId, i.guildId))
          .orderBy(desc(tbl.xp))
          .limit(10)
          .offset(page * 10);
        if (!rows.length) return i.reply({ content: userT(i)("levels.noMorePlaces"), flags: MessageFlags.Ephemeral });
        const tr = await guildT(i.guild);
        const lines = rows.map((r, idx) =>
          tr("levels.leaderboardLine", {
            pos: page * 10 + idx + 1,
            user: `<@${r.userId}>`,
            level: levelFromXp(r.xp).level,
            xp: fmtNumber(tr.lang, r.xp),
          }),
        );
        return i.reply({
          embeds: [new EmbedBuilder().setColor(await brandColor(i.guildId)).setTitle(tr("levels.leaderboardTitle", { server: i.guild.name })).setDescription(lines.join("\n"))],
          allowedMentions: { parse: [] },
        });
      },
    },
  ]);
}
