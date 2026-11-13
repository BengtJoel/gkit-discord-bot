import {
  AuditLogEvent,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type User,
  type PartialUser,
} from "discord.js";
import { enabledConfig, type ModuleConfig } from "../../settings.js";
import { guildT, type Lang } from "../../i18n/index.js";
import { bus } from "../../core/events.js";
import { log } from "../../lib/log.js";

/**
 * Server log ("audit logging" in MEE6): posts what happens on the server to one channel per
 * category. Who did it is looked up in Discord's audit log when the bot may read it.
 */
type Category = keyof ModuleConfig<"serverLog">["channels"];
type Tr = Awaited<ReturnType<typeof guildT>>;

const colors: Record<Category, number> = {
  messages: 0x3b82f6,
  members: 0x22c55e,
  roles: 0x8b5cf6,
  voice: 0x14b8a6,
  channels: 0xf59e0b,
  server: 0x64748b,
  moderation: 0xef4444,
};

const clip = (s: string, n = 1024) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ts = (d: Date | number | null | undefined, style = "R") => (d ? `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>` : "—");
const userLine = (u: User | PartialUser | null | undefined, fallbackId?: string) =>
  u ? `<@${u.id}> · ${u.username ?? ""} \`${u.id}\`` : fallbackId ? `<@${fallbackId}> \`${fallbackId}\`` : "—";

async function target(guild: Guild, cat: Category) {
  const cfg = await enabledConfig(guild.id, "serverLog");
  const channelId = cfg?.channels[cat];
  if (!cfg || !channelId) return null;
  return { cfg, channelId, tr: await guildT(guild) };
}

async function post(guild: Guild, channelId: string, embed: EmbedBuilder) {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isSendable()) return;
  await ch.send({ embeds: [embed.setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch((err) => log.debug({ err }, "server log send failed"));
}

function embed(cat: Category, title: string) {
  return new EmbedBuilder().setColor(colors[cat]).setTitle(title);
}

/** Who did it? Looks for a fresh matching audit log entry (needs View Audit Log). */
async function executor(guild: Guild, type: AuditLogEvent, targetId: string) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((e) => (e.targetId ?? (e.target as { id?: string } | null)?.id) === targetId && Date.now() - e.createdTimestamp < 15_000);
    return entry ? { user: entry.executor, reason: entry.reason } : null;
  } catch {
    return null;
  }
}

function addBy(e: EmbedBuilder, tr: Tr, who: Awaited<ReturnType<typeof executor>>) {
  if (who?.user) e.addFields({ name: tr("log.fields.by"), value: userLine(who.user), inline: true });
  if (who?.reason) e.addFields({ name: tr("log.fields.reason"), value: clip(who.reason) });
  return e;
}

function age(lang: Lang, from: number) {
  const days = Math.floor((Date.now() - from) / 86400_000);
  if (days < 1) return lang === "sv" ? "< 1 dag" : "< 1 day";
  return lang === "sv" ? `${days} ${days === 1 ? "dag" : "dagar"}` : `${days} ${days === 1 ? "day" : "days"}`;
}

/* Role changes come one event per role; group them per member for a short moment so one
 * edit in Discord gives one log entry. */
const pendingRoles = new Map<string, { member: GuildMember; added: Set<string>; removed: Set<string>; timer: NodeJS.Timeout }>();

function queueRoleChange(member: GuildMember, roleId: string, kind: "added" | "removed") {
  const k = `${member.guild.id}|${member.id}`;
  let p = pendingRoles.get(k);
  if (!p) {
    p = { member, added: new Set(), removed: new Set(), timer: setTimeout(() => void flushRoles(k), 1500) };
    pendingRoles.set(k, p);
  }
  p.member = member;
  const other = kind === "added" ? p.removed : p.added;
  if (other.has(roleId)) other.delete(roleId);
  else p[kind].add(roleId);
}

async function flushRoles(k: string) {
  const p = pendingRoles.get(k);
  pendingRoles.delete(k);
  if (!p || (!p.added.size && !p.removed.size)) return;
  const t = await target(p.member.guild, "roles");
  if (!t) return;
  const e = embed("roles", t.tr("log.titles.rolesChanged")).addFields({ name: t.tr("log.fields.user"), value: userLine(p.member.user) });
  if (p.added.size) e.addFields({ name: t.tr("log.fields.added"), value: clip([...p.added].map((id) => `<@&${id}>`).join(" ")), inline: true });
  if (p.removed.size) e.addFields({ name: t.tr("log.fields.removed"), value: clip([...p.removed].map((id) => `<@&${id}>`).join(" ")), inline: true });
  addBy(e, t.tr, await executor(p.member.guild, AuditLogEvent.MemberRoleUpdate, p.member.id));
  await post(p.member.guild, t.channelId, e);
}

export function registerServerLog(client: Client) {
  const safe =
    <A extends unknown[]>(name: string, fn: (...a: A) => Promise<unknown>) =>
    (...a: A) =>
      void fn(...a).catch((err) => log.warn({ err, event: name }, "server log handler failed"));

  /* ---------- Messages ---------- */

  client.on(
    Events.MessageUpdate,
    safe("messageUpdate", async (oldM, newM) => {
      if (!newM.inGuild() || newM.partial) return;
      const t = await target(newM.guild, "messages");
      if (!t || (t.cfg.ignoreBots && newM.author.bot) || t.cfg.ignoredChannelIds.includes(newM.channelId) || newM.channelId === t.channelId) return;
      if (oldM.partial || oldM.content === newM.content) return; // embeds unfurling etc.
      const e = embed("messages", t.tr("log.titles.messageEdited"))
        .setURL(newM.url)
        .addFields(
          { name: t.tr("log.fields.author"), value: userLine(newM.author), inline: true },
          { name: t.tr("log.fields.channel"), value: `<#${newM.channelId}>`, inline: true },
          { name: t.tr("log.fields.before"), value: clip(oldM.content || t.tr("log.noContent")) },
          { name: t.tr("log.fields.after"), value: clip(newM.content || t.tr("log.noContent")) },
        );
      await post(newM.guild, t.channelId, e);
    }),
  );

  client.on(
    Events.MessageDelete,
    safe("messageDelete", async (msg) => {
      if (!msg.guild) return;
      const t = await target(msg.guild, "messages");
      if (!t || t.cfg.ignoredChannelIds.includes(msg.channelId) || msg.channelId === t.channelId) return;
      if (!msg.partial && t.cfg.ignoreBots && msg.author?.bot) return;
      const e = embed("messages", t.tr("log.titles.messageDeleted")).addFields(
        { name: t.tr("log.fields.author"), value: msg.partial ? "—" : userLine(msg.author), inline: true },
        { name: t.tr("log.fields.channel"), value: `<#${msg.channelId}>`, inline: true },
        { name: t.tr("log.fields.content"), value: msg.partial ? t.tr("log.notCached") : clip(msg.content || t.tr("log.noContent")) },
      );
      if (!msg.partial && msg.attachments.size)
        e.addFields({ name: t.tr("log.fields.attachments"), value: clip(msg.attachments.map((a) => a.name).join(", ")) });
      await post(msg.guild, t.channelId, e);
    }),
  );

  client.on(
    Events.MessageBulkDelete,
    safe("messageBulkDelete", async (msgs, channel) => {
      if (!("guild" in channel)) return;
      const t = await target(channel.guild, "messages");
      if (!t || t.cfg.ignoredChannelIds.includes(channel.id)) return;
      const e = embed("messages", t.tr("log.titles.messagesBulkDeleted", { count: msgs.size })).addFields({
        name: t.tr("log.fields.channel"),
        value: `<#${channel.id}>`,
      });
      await post(channel.guild, t.channelId, e);
    }),
  );

  /* ---------- Members ---------- */

  client.on(
    Events.GuildMemberAdd,
    safe("memberAdd", async (m) => {
      const t = await target(m.guild, "members");
      if (!t || (t.cfg.ignoreBots && m.user.bot)) return;
      const e = embed("members", t.tr("log.titles.memberJoined"))
        .setThumbnail(m.user.displayAvatarURL())
        .addFields(
          { name: t.tr("log.fields.user"), value: userLine(m.user) },
          { name: t.tr("log.fields.accountCreated"), value: ts(m.user.createdAt), inline: true },
          { name: "​", value: t.tr("log.memberNumber", { n: m.guild.memberCount }), inline: true },
        );
      if (Date.now() - m.user.createdTimestamp < 7 * 86400_000)
        e.setDescription(t.tr("log.newAccount", { age: age(t.tr.lang, m.user.createdTimestamp) }));
      await post(m.guild, t.channelId, e);
    }),
  );

  client.on(
    Events.GuildMemberRemove,
    safe("memberRemove", async (m) => {
      const t = await target(m.guild, "members");
      if (!t || (t.cfg.ignoreBots && m.user?.bot)) return;
      const roles = m.partial ? [] : m.roles.cache.filter((r) => r.id !== m.guild.id).map((r) => `<@&${r.id}>`);
      const e = embed("members", t.tr("log.titles.memberLeft")).addFields(
        { name: t.tr("log.fields.user"), value: userLine(m.user, m.id) },
        { name: t.tr("log.fields.joined"), value: ts(m.joinedAt), inline: true },
      );
      if (roles.length) e.addFields({ name: t.tr("log.fields.roles"), value: clip(roles.join(" ")) });
      await post(m.guild, t.channelId, e);
    }),
  );

  bus.on("member.nicknameChanged", async (m, before, after) => {
    const t = await target(m.guild, "members");
    if (!t || (t.cfg.ignoreBots && m.user.bot)) return;
    const e = embed("members", t.tr("log.titles.nicknameChanged")).addFields(
      { name: t.tr("log.fields.user"), value: userLine(m.user) },
      { name: t.tr("log.fields.before"), value: before ?? t.tr("log.none"), inline: true },
      { name: t.tr("log.fields.after"), value: after ?? t.tr("log.none"), inline: true },
    );
    addBy(e, t.tr, await executor(m.guild, AuditLogEvent.MemberUpdate, m.id));
    await post(m.guild, t.channelId, e);
  });

  bus.on("member.roleAdded", (m, role) => queueRoleChange(m, role.id, "added"));
  bus.on("member.roleRemoved", (m, role) => queueRoleChange(m, role.id, "removed"));

  /* ---------- Moderation done outside the bot (Discord's own tools) ---------- */

  bus.on("member.timeoutChanged", async (m, until) => {
    const t = await target(m.guild, "moderation");
    if (!t) return;
    const e = embed("moderation", t.tr(until ? "log.titles.timeoutAdded" : "log.titles.timeoutRemoved")).addFields({
      name: t.tr("log.fields.user"),
      value: userLine(m.user),
    });
    if (until) e.addFields({ name: t.tr("log.fields.until"), value: ts(until, "f"), inline: true });
    addBy(e, t.tr, await executor(m.guild, AuditLogEvent.MemberUpdate, m.id));
    await post(m.guild, t.channelId, e);
  });

  client.on(
    Events.GuildBanAdd,
    safe("banAdd", async (ban) => {
      const t = await target(ban.guild, "moderation");
      if (!t) return;
      const e = embed("moderation", t.tr("log.titles.banned")).addFields({ name: t.tr("log.fields.user"), value: userLine(ban.user) });
      addBy(e, t.tr, await executor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id));
      await post(ban.guild, t.channelId, e);
    }),
  );
  client.on(
    Events.GuildBanRemove,
    safe("banRemove", async (ban) => {
      const t = await target(ban.guild, "moderation");
      if (!t) return;
      const e = embed("moderation", t.tr("log.titles.unbanned")).addFields({ name: t.tr("log.fields.user"), value: userLine(ban.user) });
      addBy(e, t.tr, await executor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id));
      await post(ban.guild, t.channelId, e);
    }),
  );

  /* ---------- Voice ---------- */

  client.on(
    Events.VoiceStateUpdate,
    safe("voice", async (oldS, newS) => {
      if (oldS.channelId === newS.channelId) return;
      const member = newS.member ?? oldS.member;
      if (!member) return;
      const t = await target(newS.guild, "voice");
      if (!t || (t.cfg.ignoreBots && member.user.bot)) return;
      if (t.cfg.ignoredChannelIds.some((id) => id === oldS.channelId || id === newS.channelId)) return;
      const key = !oldS.channelId ? "voiceJoined" : !newS.channelId ? "voiceLeft" : "voiceMoved";
      const e = embed("voice", t.tr(`log.titles.${key}`)).addFields({ name: t.tr("log.fields.user"), value: userLine(member.user) });
      if (oldS.channelId) e.addFields({ name: t.tr("log.fields.from"), value: `<#${oldS.channelId}>`, inline: true });
      if (newS.channelId) e.addFields({ name: t.tr("log.fields.to"), value: `<#${newS.channelId}>`, inline: true });
      await post(newS.guild, t.channelId, e);
    }),
  );

  /* ---------- Channels ---------- */

  client.on(
    Events.ChannelCreate,
    safe("channelCreate", async (ch) => {
      const t = await target(ch.guild, "channels");
      if (!t) return;
      const e = embed("channels", t.tr("log.titles.channelCreated")).addFields({ name: t.tr("log.fields.name"), value: `<#${ch.id}> · ${ch.name}` });
      addBy(e, t.tr, await executor(ch.guild, AuditLogEvent.ChannelCreate, ch.id));
      await post(ch.guild, t.channelId, e);
    }),
  );
  client.on(
    Events.ChannelDelete,
    safe("channelDelete", async (ch) => {
      if (ch.isDMBased()) return;
      const t = await target(ch.guild, "channels");
      if (!t) return;
      const e = embed("channels", t.tr("log.titles.channelDeleted")).addFields({ name: t.tr("log.fields.name"), value: ch.name });
      addBy(e, t.tr, await executor(ch.guild, AuditLogEvent.ChannelDelete, ch.id));
      await post(ch.guild, t.channelId, e);
    }),
  );
  client.on(
    Events.ChannelUpdate,
    safe("channelUpdate", async (oldC, newC) => {
      if (newC.isDMBased() || oldC.isDMBased()) return;
      const changes: string[] = [];
      if (oldC.name !== newC.name) changes.push(`**${oldC.name}** → **${newC.name}**`);
      const oldTopic = "topic" in oldC ? oldC.topic : null;
      const newTopic = "topic" in newC ? newC.topic : null;
      if (oldTopic !== newTopic) changes.push(`${clip(oldTopic ?? "—", 300)} → ${clip(newTopic ?? "—", 300)}`);
      if (!changes.length) return; // permission/position shuffles are too noisy to log
      const t = await target(newC.guild, "channels");
      if (!t) return;
      const e = embed("channels", t.tr("log.titles.channelUpdated")).addFields(
        { name: t.tr("log.fields.channel"), value: `<#${newC.id}>` },
        { name: t.tr("log.fields.changes"), value: clip(changes.join("\n")) },
      );
      addBy(e, t.tr, await executor(newC.guild, AuditLogEvent.ChannelUpdate, newC.id));
      await post(newC.guild, t.channelId, e);
    }),
  );

  /* ---------- Roles ---------- */

  client.on(
    Events.GuildRoleCreate,
    safe("roleCreate", async (role) => {
      const t = await target(role.guild, "roles");
      if (!t) return;
      const e = embed("roles", t.tr("log.titles.roleCreated")).addFields({ name: t.tr("log.fields.name"), value: `<@&${role.id}> · ${role.name}` });
      addBy(e, t.tr, await executor(role.guild, AuditLogEvent.RoleCreate, role.id));
      await post(role.guild, t.channelId, e);
    }),
  );
  client.on(
    Events.GuildRoleDelete,
    safe("roleDelete", async (role) => {
      const t = await target(role.guild, "roles");
      if (!t) return;
      const e = embed("roles", t.tr("log.titles.roleDeleted")).addFields({ name: t.tr("log.fields.name"), value: role.name });
      addBy(e, t.tr, await executor(role.guild, AuditLogEvent.RoleDelete, role.id));
      await post(role.guild, t.channelId, e);
    }),
  );
  client.on(
    Events.GuildRoleUpdate,
    safe("roleUpdate", async (oldR, newR) => {
      const changes: string[] = [];
      if (oldR.name !== newR.name) changes.push(`**${oldR.name}** → **${newR.name}**`);
      if (oldR.color !== newR.color) changes.push(`${oldR.hexColor} → ${newR.hexColor}`);
      const added = newR.permissions.toArray().filter((p) => !oldR.permissions.has(p));
      const removed = oldR.permissions.toArray().filter((p) => !newR.permissions.has(p));
      if (added.length) changes.push(`+ ${added.join(", ")}`);
      if (removed.length) changes.push(`− ${removed.join(", ")}`);
      if (!changes.length) return; // position changes only
      const t = await target(newR.guild, "roles");
      if (!t) return;
      const e = embed("roles", t.tr("log.titles.roleUpdated")).addFields(
        { name: t.tr("log.fields.name"), value: `<@&${newR.id}>` },
        { name: t.tr("log.fields.changes"), value: clip(changes.join("\n")) },
      );
      addBy(e, t.tr, await executor(newR.guild, AuditLogEvent.RoleUpdate, newR.id));
      await post(newR.guild, t.channelId, e);
    }),
  );

  /* ---------- Server ---------- */

  client.on(
    Events.GuildUpdate,
    safe("guildUpdate", async (oldG, newG) => {
      const changes: string[] = [];
      if (oldG.name !== newG.name) changes.push(`**${oldG.name}** → **${newG.name}**`);
      if (oldG.icon !== newG.icon) changes.push("Icon");
      if (oldG.vanityURLCode !== newG.vanityURLCode) changes.push(`discord.gg/${oldG.vanityURLCode ?? "—"} → ${newG.vanityURLCode ?? "—"}`);
      if (!changes.length) return;
      const t = await target(newG, "server");
      if (!t) return;
      const e = embed("server", t.tr("log.titles.serverUpdated")).addFields({ name: t.tr("log.fields.changes"), value: clip(changes.join("\n")) });
      addBy(e, t.tr, await executor(newG, AuditLogEvent.GuildUpdate, newG.id));
      await post(newG, t.channelId, e);
    }),
  );
  client.on(
    Events.GuildEmojiCreate,
    safe("emojiCreate", async (em) => {
      const t = await target(em.guild, "server");
      if (!t) return;
      await post(em.guild, t.channelId, embed("server", t.tr("log.titles.emojiCreated")).addFields({ name: t.tr("log.fields.name"), value: `${em} \`:${em.name}:\`` }));
    }),
  );
  client.on(
    Events.GuildEmojiDelete,
    safe("emojiDelete", async (em) => {
      const t = await target(em.guild, "server");
      if (!t) return;
      await post(em.guild, t.channelId, embed("server", t.tr("log.titles.emojiDeleted")).addFields({ name: t.tr("log.fields.name"), value: `\`:${em.name}:\`` }));
    }),
  );
}
