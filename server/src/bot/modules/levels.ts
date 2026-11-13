import {
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type Client,
  type GuildMember,
  type Message,
} from "discord.js";
import { and, desc, eq, gt, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { enabledConfig, type ModuleConfig } from "../../settings.js";
import { renderTemplate } from "../../lib/template.js";
import { defineCommands } from "../registry.js";
import { recordEvent } from "./activity.js";
import { log } from "../../lib/log.js";

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

  const t = schema.memberLevels;
  const [row] = await db
    .insert(t)
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
      target: [t.guildId, t.userId],
      set: {
        xp: dsql`${t.xp} + ${gain}`,
        messageCount: dsql`${t.messageCount} + 1`,
        username: msg.author.username,
        avatar: msg.author.avatar,
        lastXpAt: new Date(),
      },
    })
    .returning();

  const { level } = levelFromXp(row.xp);
  if (level > row.level) {
    await db.update(t).set({ level }).where(and(eq(t.guildId, msg.guildId), eq(t.userId, msg.author.id)));
    await onLevelUp(msg, member, level, cfg);
  }
}

async function onLevelUp(msg: Message<true>, member: GuildMember, level: number, cfg: ModuleConfig<"levels">) {
  await recordEvent(msg.guildId, "level_up", { userId: member.id, channelId: msg.channelId, data: { level } });
  await syncRewardRoles(member, level, cfg).catch((err) => log.warn({ err }, "reward role sync failed"));

  if (cfg.announce.mode === "off") return;
  const text = renderTemplate(cfg.announce.message, { member, guild: msg.guild, extra: { level } });
  try {
    if (cfg.announce.mode === "dm") await member.send(text);
    else if (cfg.announce.mode === "channel" && cfg.announce.channelId) {
      const ch = await msg.guild.channels.fetch(cfg.announce.channelId);
      if (ch?.isTextBased()) await ch.send(text);
    } else if (msg.channel.isSendable()) await msg.channel.send(text);
  } catch (err) {
    log.debug({ err }, "level announce failed");
  }
}

export async function syncRewardRoles(member: GuildMember, level: number, cfg: ModuleConfig<"levels">) {
  const earned = cfg.roleRewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  if (!earned.length) return;
  const keep = cfg.stackRewards ? earned : earned.slice(-1);
  const remove = cfg.stackRewards ? [] : earned.slice(0, -1);
  const toAdd = keep.map((r) => r.roleId).filter((id) => !member.roles.cache.has(id));
  const toRemove = remove.map((r) => r.roleId).filter((id) => member.roles.cache.has(id));
  if (toAdd.length) await member.roles.add(toAdd, `Level ${level} belöning`);
  if (toRemove.length) await member.roles.remove(toRemove, `Level ${level} belöning (ersatt)`);
}

export async function getRank(guildId: string, userId: string) {
  const t = schema.memberLevels;
  const [row] = await db.select().from(t).where(and(eq(t.guildId, guildId), eq(t.userId, userId)));
  if (!row) return null;
  const [{ count }] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.guildId, guildId), gt(t.xp, row.xp)));
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

  defineCommands([
    {
      module: "levels",
      data: new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Visa level och XP")
        .addUserOption((o) => o.setName("user").setDescription("Vems rank?"))
        .toJSON(),
      async execute(i) {
        const user = i.options.getUser("user") ?? i.user;
        const r = await getRank(i.guildId, user.id);
        if (!r) return i.reply({ content: `${user} har ingen XP ännu.`, flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .addFields(
            { name: "Rank", value: `#${r.rank}`, inline: true },
            { name: "Level", value: String(r.level), inline: true },
            { name: "XP", value: `${r.current.toLocaleString("sv")} / ${r.needed.toLocaleString("sv")}`, inline: true },
          )
          .setDescription(bar(r.current, r.needed));
        return i.reply({ embeds: [embed] });
      },
    },
    {
      module: "levels",
      data: new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription("Topplistan för servern")
        .addIntegerOption((o) => o.setName("sida").setDescription("Sida").setMinValue(1))
        .toJSON(),
      async execute(i) {
        const page = (i.options.getInteger("sida") ?? 1) - 1;
        const t = schema.memberLevels;
        const rows = await db
          .select()
          .from(t)
          .where(eq(t.guildId, i.guildId))
          .orderBy(desc(t.xp))
          .limit(10)
          .offset(page * 10);
        if (!rows.length) return i.reply({ content: "Inga fler placeringar.", flags: MessageFlags.Ephemeral });
        const lines = rows.map(
          (r, idx) => `**${page * 10 + idx + 1}.** <@${r.userId}> — level ${levelFromXp(r.xp).level} · ${r.xp.toLocaleString("sv")} XP`,
        );
        return i.reply({
          embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`Topplista — ${i.guild.name}`).setDescription(lines.join("\n"))],
          allowedMentions: { parse: [] },
        });
      },
    },
  ]);
}
