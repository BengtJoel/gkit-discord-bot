import { Events, type Client } from "discord.js";
import { brandColor, enabledConfig } from "../../settings.js";
import { buildDesigned } from "../../lib/design.js";
import { recordEvent, upsertMember } from "./activity.js";
import { guildT } from "../../i18n/index.js";
import { addRoles, sendDm, sendToChannel } from "../../core/actions.js";

export function registerWelcome(client: Client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    await upsertMember(member).catch(() => {});
    await recordEvent(member.guild.id, "member_join", { userId: member.id, data: { username: member.user.username } });

    const cfg = await enabledConfig(member.guild.id, "welcome");
    if (!cfg) return;
    const tr = await guildT(member.guild);
    const ctx = { member, guild: member.guild };
    const action = { source: "welcome", reason: tr("welcome.autoroleReason") };
    if (cfg.autoRoleIds.length && !member.pending) await addRoles(member, cfg.autoRoleIds, action);
    const color = await brandColor(member.guild.id);
    if (cfg.join.enabled && cfg.join.channelId) {
      const payload = await buildDesigned(cfg.join, { ...ctx, brandColor: color, fallbackText: tr("defaults.welcomeJoin") });
      await sendToChannel(member.guild, cfg.join.channelId, payload, action);
    }
    if (cfg.dm.enabled) {
      const payload = await buildDesigned(cfg.dm, { ...ctx, brandColor: color, fallbackText: tr("defaults.welcomeDm") });
      await sendDm(member.guild, member.user, payload, action);
    }
  });

  // Membership screening: give autoroles once the member accepts the rules
  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    if (!(oldM.pending && !newM.pending)) return;
    const cfg = await enabledConfig(newM.guild.id, "welcome");
    if (!cfg?.autoRoleIds.length) return;
    const tr = await guildT(newM.guild);
    await addRoles(newM, cfg.autoRoleIds, { source: "welcome", reason: tr("welcome.autoroleReason") });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await upsertMember(member, true).catch(() => {});
    await recordEvent(member.guild.id, "member_leave", { userId: member.id, data: { username: member.user?.username } });
    const cfg = await enabledConfig(member.guild.id, "welcome");
    if (!cfg?.leave.enabled || !cfg.leave.channelId) return;
    const tr = await guildT(member.guild);
    const payload = await buildDesigned(cfg.leave, {
      guild: member.guild,
      user: member.user,
      member: member.partial ? null : member,
      brandColor: await brandColor(member.guild.id),
      fallbackText: tr("defaults.welcomeLeave"),
    });
    await sendToChannel(member.guild, cfg.leave.channelId, payload, { source: "welcome" });
  });
}
